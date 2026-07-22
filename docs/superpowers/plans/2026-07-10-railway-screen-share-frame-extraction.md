# Railway Screen Share Frame Extraction Implementation Plan

> Historical implementation record from July 10, 2026. The worker was implemented and the original task list is no longer executable guidance. Use the [setup guide](../../setup.md) and [testing architecture](../../testing.md) for current deployment and verification.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture every unique stable screen shared state from Recall recordings as source resolution JPEG assets using a dedicated Railway ffmpeg worker.

**Architecture:** Vercel continues to receive Recall webhooks and emits a durable Inngest event containing meeting and Recall identifiers. A minimal Node HTTP service on Railway registers only the image extraction function, retrieves fresh Recall media URLs, scans confirmed screen share intervals with ffmpeg, stores deterministic JPEG assets in R2, and writes `video_frame` rows to Neon.

**Tech Stack:** TypeScript, Node 24, Inngest 4, ffmpeg and ffprobe, Drizzle ORM, Neon Postgres, Cloudflare R2, Vitest, esbuild, Docker, Railway

---

## File Structure

Create focused units instead of adding extraction concerns to the existing transcription modules:

1. `lib/recall-screen-share.ts` parses Recall participant events and builds screen share intervals.
2. `lib/video-frame-detection.ts` owns grayscale comparison, stability, and global deduplication.
3. `lib/video-frame-ffmpeg.ts` owns ffprobe, low resolution sampling, and source resolution JPEG extraction.
4. `lib/meeting-video-frames.ts` coordinates Recall, ffmpeg, R2, and `media_assets` persistence.
5. `services/image-worker/client.ts` creates the Railway Inngest client.
6. `services/image-worker/functions.ts` defines the extraction function and concurrency.
7. `services/image-worker/server.ts` exposes `/api/inngest` and `/health` with the native Node adapter.
8. `Dockerfile.image-worker`, `.dockerignore`, and `railway.json` define the Railway artifact.
9. `scripts/sync-image-worker-inngest.mjs` registers the deployed Railway endpoint with Inngest Cloud.

No database migration is required because `media_assets` already supports `video_frame`, checksum, timestamps, and deterministic object uniqueness.

### Task 1: Configure Recall And Expose Video Frame Artifacts

**Files:**

- Modify: `lib/vendors/recall.ts`
- Modify: `tests/ingest.test.ts`
- Modify: `tests/recall-calendar.test.ts`

- [ ] **Step 1: Write failing Recall request tests**

Update existing request body assertions so every create and update path requires:

```ts
expect(body.recording_config).toMatchObject({
  video_mixed_participant_video_when_screenshare: "hide",
});
```

Add focused artifact helper coverage:

```ts
expect(findRecallVideoFrameArtifacts(bot, "recording_123")).toEqual({
  participantEventsUrl: "https://recall.example.com/events.json",
  recordingStartedAt: "2026-07-10T10:00:00.000Z",
  videoUrl: "https://recall.example.com/video.mp4",
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm test -- tests/ingest.test.ts tests/recall-calendar.test.ts
```

Expected: FAIL because the recording config does not hide participant video and `findRecallVideoFrameArtifacts` does not exist.

- [ ] **Step 3: Add the recording config and artifact helper**

Extend `buildRecallRealtimeRecordingConfig`:

```ts
function buildRecallRealtimeRecordingConfig(webhookUrl: string) {
  return {
    video_mixed_participant_video_when_screenshare: "hide" as const,
    realtime_endpoints: [
      {
        type: "webhook",
        url: webhookUrl,
        events: [
          RECALL_CHAT_MESSAGE_EVENT,
          RECALL_SPEECH_ON_EVENT,
          RECALL_SPEECH_OFF_EVENT,
        ],
      },
    ],
  };
}
```

Export one strict helper that selects the requested recording and returns only complete frame extraction inputs:

```ts
export function findRecallVideoFrameArtifacts(
  bot: unknown,
  recordingId: string,
): {
  participantEventsUrl: string;
  recordingStartedAt: string;
  videoUrl: string;
} | null;
```

The helper reads:

```ts
recording.media_shortcuts.video_mixed.data.download_url
recording.media_shortcuts.participant_events.data.participant_events_download_url
recording.started_at
```

Return `null` if any required value is missing or malformed.

- [ ] **Step 4: Run focused tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit Recall configuration**

```bash
git add lib/vendors/recall.ts tests/ingest.test.ts tests/recall-calendar.test.ts
git commit -m "feat: configure Recall screen share recording"
```

### Task 2: Parse Confirmed Screen Share Intervals

**Files:**

- Create: `lib/recall-screen-share.ts`
- Create: `tests/recall-screen-share.test.ts`

- [ ] **Step 1: Write interval parser tests**

Cover pairing, overlap, unmatched events, short intervals, and no screen share:

```ts
expect(buildScreenShareIntervals({
  durationMs: 60_000,
  events: [
    event("screenshare_on", 10),
    event("screenshare_on", 12),
    event("screenshare_off", 20),
    event("screenshare_off", 25),
  ],
})).toEqual([{ startMs: 10_000, endMs: 25_000 }]);

expect(buildScreenShareIntervals({
  durationMs: 60_000,
  events: [event("screenshare_on", 58)],
})).toEqual([{ startMs: 58_000, endMs: 60_000 }]);

expect(buildScreenShareIntervals({
  durationMs: 60_000,
  events: [event("speech_on", 10)],
})).toEqual([]);
```

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm test -- tests/recall-screen-share.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict parsing and interval merging**

Export:

```ts
export type ScreenShareInterval = { startMs: number; endMs: number };

export function parseRecallParticipantEvents(input: unknown): RecallParticipantEvent[];

export function buildScreenShareIntervals(input: {
  durationMs: number;
  events: RecallParticipantEvent[];
}): ScreenShareInterval[];
```

Parse only events with `action` equal to `screenshare_on` or `screenshare_off`, a finite nonnegative `timestamp.relative`, and a participant ID. Track open intervals per participant, close unmatched starts at duration, sort, merge overlaps, and discard intervals shorter than 2,000 milliseconds.

- [ ] **Step 4: Run the parser tests**

Expected: PASS.

- [ ] **Step 5: Commit interval parsing**

```bash
git add lib/recall-screen-share.ts tests/recall-screen-share.test.ts
git commit -m "feat: parse Recall screen share intervals"
```

### Task 3: Select Unlimited Stable Visual States

**Files:**

- Create: `lib/video-frame-detection.ts`
- Create: `tests/video-frame-detection.test.ts`

- [ ] **Step 1: Write synthetic grayscale tests**

Create 160 by 90 grayscale frames and prove the required behavior:

```ts
expect(selectStableVisualFrames([
  frame(0, slideA),
  frame(1_000, slideA),
  frame(2_000, slideA),
  frame(3_000, transition),
  frame(4_000, slideB),
  frame(5_000, slideB),
  frame(6_000, slideB),
  frame(7_000, slideA),
  frame(8_000, slideA),
  frame(9_000, slideA),
])).toEqual([2_000, 6_000]);
```

Add tests for cursor sized changes, persistent bullet reveals, more than 40 unique stable states, unstable moving video, and a repeated slide.

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm test -- tests/video-frame-detection.test.ts
```

Expected: FAIL because the selector does not exist.

- [ ] **Step 3: Implement comparison and stability state**

Export:

```ts
export type GrayscaleFrame = {
  pixels: Uint8Array;
  timestampMs: number;
};

export function compareGrayscaleFrames(
  left: Uint8Array,
  right: Uint8Array,
): { changedPixelRatio: number; meanAbsoluteDifference: number };

export function selectStableVisualFrames(
  frames: GrayscaleFrame[],
): number[];
```

Use these constants from the approved design:

```ts
const CHANGE_MEAN_THRESHOLD = 3;
const CHANGE_PIXEL_RATIO_THRESHOLD = 0.008;
const PIXEL_DELTA_THRESHOLD = 20;
const STABLE_MEAN_THRESHOLD = 1.5;
const STABLE_PIXEL_RATIO_THRESHOLD = 0.005;
const STABLE_DURATION_MS = 2_000;
```

Maintain a candidate until it remains stable for two seconds. Compare accepted candidates against every previously accepted state and reject a global duplicate. Do not slice or cap the returned timestamps.

- [ ] **Step 4: Run selector tests**

Expected: PASS, including the case with more than 40 unique states.

- [ ] **Step 5: Commit stable frame selection**

```bash
git add lib/video-frame-detection.ts tests/video-frame-detection.test.ts
git commit -m "feat: select stable shared screen frames"
```

### Task 4: Add The ffmpeg Adapter

**Files:**

- Create: `lib/video-frame-ffmpeg.ts`
- Create: `tests/video-frame-ffmpeg.test.ts`

- [ ] **Step 1: Write process adapter tests**

Inject a process runner so tests assert arguments without executing remote media:

```ts
expect(run).toHaveBeenCalledWith("ffmpeg", expect.arrayContaining([
  "-ss", "10.000",
  "-t", "20.000",
  "-vf", "fps=1,scale=160:90,format=gray",
  "-f", "rawvideo",
  "pipe:1",
]));

expect(jpegArgs).toEqual(expect.arrayContaining([
  "-ss", "12.000",
  "-frames:v", "1",
  "-q:v", "2",
  "-pix_fmt", "yuvj444p",
]));
```

Test raw output splitting into exact 14,400 byte frames and timestamp assignment.

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm test -- tests/video-frame-ffmpeg.test.ts
```

- [ ] **Step 3: Implement ffprobe, scan, and JPEG extraction**

Export:

```ts
export async function probeVideoDurationMs(videoUrl: string): Promise<number>;

export async function sampleScreenShareFrames(input: {
  intervals: ScreenShareInterval[];
  videoUrl: string;
}): Promise<GrayscaleFrame[]>;

export async function extractJpegFrame(input: {
  timestampMs: number;
  videoUrl: string;
}): Promise<Uint8Array>;
```

Resolve binaries from `FFMPEG_PATH` and `FFPROBE_PATH`, falling back to `ffmpeg` and `ffprobe`. Limit captured stderr to 4,000 characters, reject nonzero exits, reject incomplete raw frames, and reject an empty JPEG.

Use `-ss` before `-i` for each final JPEG seek. Do not add a scale filter to final extraction.

- [ ] **Step 4: Run adapter tests**

Expected: PASS.

- [ ] **Step 5: Commit the ffmpeg adapter**

```bash
git add lib/video-frame-ffmpeg.ts tests/video-frame-ffmpeg.test.ts
git commit -m "feat: extract source resolution meeting frames"
```

### Task 5: Persist Idempotent Video Frames

**Files:**

- Create: `lib/meeting-video-frames.ts`
- Create: `tests/meeting-video-frames.test.ts`

- [ ] **Step 1: Write orchestration tests**

Mock Recall, ffmpeg, R2, and Drizzle. Cover:

```ts
await expect(persistRecallMeetingVideoFrames(input)).resolves.toEqual({
  duplicateCount: 1,
  frameCount: 2,
  intervalCount: 1,
});
```

Assert that valid events without screen sharing return zero frames without invoking ffmpeg JPEG extraction. Assert that malformed events throw. Assert deterministic keys contain `screen-share-v1` and timestamp, existing keys skip both extraction and upload, and inserted rows use `type: "video_frame"` with checksum and timestamps.

- [ ] **Step 2: Verify the tests fail**

```bash
pnpm test -- tests/meeting-video-frames.test.ts
```

- [ ] **Step 3: Implement meeting frame persistence**

Export:

```ts
export async function persistRecallMeetingVideoFrames(input: {
  meetingId: string;
  recallBotId: string;
  recallRecordingId: string;
}): Promise<{
  duplicateCount: number;
  frameCount: number;
  intervalCount: number;
}>;
```

The function must:

1. Load meeting `teamId`.
2. Retrieve the bot and exact recording artifacts.
3. Probe video duration.
4. Fetch and strictly parse participant events.
5. Build intervals and return zero on a valid no share result.
6. Sample thumbnails and select stable timestamps.
7. Load existing frame object keys for retry skip behavior.
8. Extract each missing JPEG at source resolution.
9. Compute SHA 256 checksum.
10. Upload to R2.
11. Insert `video_frame` metadata with deterministic object conflict handling.

Use recording `started_at` plus `timestampMs` for `capturedAt`.

- [ ] **Step 4: Run persistence tests**

Expected: PASS.

- [ ] **Step 5: Commit persistence**

```bash
git add lib/meeting-video-frames.ts tests/meeting-video-frames.test.ts
git commit -m "feat: persist Recall shared screen frames"
```

### Task 6: Build The Railway Image Worker

**Files:**

- Create: `services/image-worker/client.ts`
- Create: `services/image-worker/functions.ts`
- Create: `services/image-worker/server.ts`
- Create: `tests/image-worker.test.ts`
- Create: `Dockerfile.image-worker`
- Create: `.dockerignore`
- Create: `railway.json`
- Create: `scripts/sync-image-worker-inngest.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write worker function and health tests**

Assert the function contract has retries and concurrency one, rejects invalid event data, delegates to `persistRecallMeetingVideoFrames`, and exposes a health response:

```ts
expect(await requestHealth(server)).toEqual({
  status: 200,
  body: { ok: true, service: "meeting-image-worker" },
});
```

- [ ] **Step 2: Verify tests fail**

```bash
pnpm test -- tests/image-worker.test.ts
```

- [ ] **Step 3: Implement the native Node Inngest service**

Create a client with app ID `meeting-image-worker`. Define one function:

```ts
export const extractMeetingVideoFrames = imageWorkerInngest.createFunction(
  {
    id: "extract-meeting-video-frames",
    retries: 2,
    concurrency: 1,
    triggers: [{ event: "meeting/extract.video-frames" }],
  },
  async ({ event }) => persistRecallMeetingVideoFrames(dataSchema.parse(event.data)),
);
```

Use `serve` from `inngest/node`. Export `createImageWorkerServer` for tests, route `/health` directly, route `/api/inngest` to Inngest, and return 404 otherwise. Listen on `PORT` with default 3001 only when the module is the process entrypoint.

- [ ] **Step 4: Add a reproducible worker build**

Add direct `esbuild` development dependency and scripts:

```json
{
  "build:image-worker": "esbuild services/image-worker/server.ts --bundle --platform=node --target=node24 --format=esm --packages=external --outfile=dist/image-worker/server.mjs",
  "start:image-worker": "node dist/image-worker/server.mjs"
}
```

`Dockerfile.image-worker` uses Node 24 Debian, installs `ffmpeg` and CA certificates in the runtime image, installs production dependencies, and starts the built worker. `railway.json` selects that Dockerfile, configures `/health`, and restarts on failure.

- [ ] **Step 5: Add the production sync script**

Mirror the existing Inngest sync script but require `IMAGE_WORKER_URL` and run:

```bash
npx inngest-cli api --prod sync-app meeting-image-worker --url "$IMAGE_WORKER_URL/api/inngest"
```

- [ ] **Step 6: Verify worker build and health**

```bash
pnpm run build:image-worker
PORT=3001 node dist/image-worker/server.mjs
curl --fail http://127.0.0.1:3001/health
```

Expected health body:

```json
{"ok":true,"service":"meeting-image-worker"}
```

- [ ] **Step 7: Commit worker packaging**

```bash
git add services/image-worker tests/image-worker.test.ts Dockerfile.image-worker .dockerignore railway.json scripts/sync-image-worker-inngest.mjs package.json pnpm-lock.yaml
git commit -m "feat: add Railway image worker"
```

### Task 7: Queue Extraction And Remove Native Screenshot Reliance

**Files:**

- Modify: `lib/recall-meetings.ts`
- Modify: `tests/recall-meetings.test.ts`
- Delete: `lib/meeting-screenshots.ts`
- Delete: `tests/meeting-screenshots.test.ts`
- Modify: `lib/vendors/recall.ts`

- [ ] **Step 1: Update webhook tests first**

Require completed media events with a recording ID to send:

```ts
expect(send).toHaveBeenCalledWith({
  id: "video-frames:recording_123",
  name: "meeting/extract.video-frames",
  data: {
    meetingId: "11111111-1111-4111-8111-111111111111",
    recallBotId: "bot_123",
    recallRecordingId: "recording_123",
  },
});
```

Prove extraction still queues when a transcript job already exists. Prove `video_mixed.done` queues extraction but not transcription. Remove expectations for `persistRecallBotScreenshots`.

- [ ] **Step 2: Verify webhook tests fail**

```bash
pnpm test -- tests/recall-meetings.test.ts
```

- [ ] **Step 3: Send the idempotent extraction event independently**

Queue extraction outside `queueRecallRecordingTranscription`, only when bot ID and recording ID exist and either `recording.done`, `video_mixed.done`, or `recording_done` is reported. Use Inngest event ID `video-frames:${recordingId}` so recording and media completion events do not create duplicate runs.

Remove the native screenshot import and call. Remove the now unused native screenshot module, tests, Recall screenshot type, parser, and API method.

- [ ] **Step 4: Run Recall tests**

Expected: PASS.

- [ ] **Step 5: Commit event wiring**

```bash
git add lib/recall-meetings.ts tests/recall-meetings.test.ts lib/vendors/recall.ts
git add -u lib/meeting-screenshots.ts tests/meeting-screenshots.test.ts
git commit -m "feat: queue owned screenshot extraction"
```

### Task 8: Integration Verification And Railway Deployment

**Files:**

- Create: `tests/video-frame-extraction.integration.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add a generated video integration test**

Generate a short 1280 by 720 MP4 during the test with:

1. Three seconds of gallery colored blocks.
2. Three seconds of slide A.
3. One second transition.
4. Three seconds of slide B with small text.
5. Three seconds returning to slide A.

Provide screen share events covering only the presentation section. Assert two JPEGs, no gallery frame, no repeated slide, 1280 by 720 dimensions, and readable nonempty output.

Skip with an explicit reason only when ffmpeg or ffprobe is unavailable.

- [ ] **Step 2: Run the integration test**

```bash
FFMPEG_PATH=/opt/homebrew/bin/ffmpeg FFPROBE_PATH=/opt/homebrew/bin/ffprobe pnpm test -- tests/video-frame-extraction.integration.test.ts
```

Expected: PASS with exactly two selected presentation frames.

- [ ] **Step 3: Document worker environment and operations**

Add these Railway variables to `.env.example` without values and document them in `README.md`:

```text
DATABASE_URL
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
R2_ACCESS_KEY_ID
R2_ACCOUNT_ID
R2_BUCKET
R2_SECRET_ACCESS_KEY
RECALL_API_BASE_URL
RECALL_API_KEY
```

Document Railway build, health check, Inngest sync, concurrency one, Serverless, one GB memory, and the 10 dollar hard limit.

- [ ] **Step 4: Run all local quality gates**

```bash
pnpm test
pnpm run lint
pnpm run build:image-worker
pnpm run build
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 5: Build the production container**

```bash
docker build -f Dockerfile.image-worker -t meeting-image-worker:local .
docker run --rm -p 3001:3001 --env-file .env.local meeting-image-worker:local
curl --fail http://127.0.0.1:3001/health
```

Expected: image builds and health returns 200. If Docker is unavailable, record this exact unverified gate and rely on Railway build logs before declaring deployment complete.

- [ ] **Step 6: Commit integration coverage and documentation**

```bash
git add tests/video-frame-extraction.integration.test.ts .env.example README.md
git commit -m "test: verify shared screen extraction pipeline"
```

- [ ] **Step 7: Deploy only the image worker to Railway**

Create or link a Railway project named `meeting-note-image-worker`, create one service from this repository, apply `railway.json`, set the documented variables from existing production secrets without printing them, generate a public domain, enable Serverless, set one GB memory, concurrency one in code, and a 10 dollar workspace hard limit.

Deploy with:

```bash
railway up --detach
railway deployment list
railway logs
```

Expected: Railway reports a successful deployment and `/health` returns 200.

- [ ] **Step 8: Register the Railway endpoint with Inngest**

```bash
IMAGE_WORKER_URL=https://<railway-domain> pnpm run inngest:sync:image-worker
```

Expected: Inngest reports app `meeting-image-worker` synchronized with function `extract-meeting-video-frames`.

- [ ] **Step 9: Deploy the Vercel event producer**

Push the completed commits through the repository's normal Vercel deployment flow. Verify the production deployment is ready and the existing `/api/inngest` endpoint still exposes only the Vercel functions.

- [ ] **Step 10: Run the production canary**

Process one completed meeting with screen sharing. Verify:

1. Railway run succeeds.
2. At least one `video_frame` row exists.
3. Every frame timestamp is inside a Recall screen share interval.
4. JPEG dimensions equal 1280 by 720 for current Recall sources.
5. The meeting page renders the images and transcript jump works.
6. No gallery only frame is stored.
7. Railway usage stays below the hard limit.

Do not run historical backfill in this implementation.

## Plan Self Review

1. Spec coverage: Recall layout, event intervals, unlimited stable selection, source resolution JPEG, Railway isolation, retries, persistence, security, cost controls, canary, and no initial backfill each map to a task above.
2. Type consistency: `ScreenShareInterval`, `GrayscaleFrame`, `findRecallVideoFrameArtifacts`, `persistRecallMeetingVideoFrames`, and event field names are consistent across tasks.
3. Scope: historical overlay removal and general R2 retention remain excluded as required.
4. Placeholder scan: deployment uses a runtime Railway domain by necessity; all code behavior and verification expectations are otherwise concrete.
