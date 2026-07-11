import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mediaAssets } from "@/db/schema";

const {
  analyzeStableVisualFrames,
  extractJpegFrame,
  findRecallVideoFrameArtifacts,
  insert,
  probeVideoDurationMs,
  putObject,
  retrieveRecallBot,
  sampleScreenShareFrames,
  select,
} = vi.hoisted(() => ({
  analyzeStableVisualFrames: vi.fn(),
  extractJpegFrame: vi.fn(),
  findRecallVideoFrameArtifacts: vi.fn(),
  insert: vi.fn(),
  probeVideoDurationMs: vi.fn(),
  putObject: vi.fn(),
  retrieveRecallBot: vi.fn(),
  sampleScreenShareFrames: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert, select },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return { ...actual, putObject };
});

vi.mock("@/lib/vendors/recall", () => ({
  findRecallVideoFrameArtifacts,
  retrieveRecallBot,
}));

vi.mock("@/lib/video-frame-detection", () => ({
  analyzeStableVisualFrames,
}));

vi.mock("@/lib/video-frame-ffmpeg", () => ({
  extractJpegFrame,
  probeVideoDurationMs,
  sampleScreenShareFrames,
}));

const MEETING_ID = "meeting_123";
const RECORDING_ID = "recording_123";
const TEAM_ID = "team_123";
const RECORDING_STARTED_AT = "2026-07-10T10:00:00.000Z";
const VIDEO_URL = "https://cdn.recall.ai/video.mp4?token=video-secret";
const EVENTS_URL =
  "https://us-east-1.recall.ai/events.json?token=event-secret";
const SIGNED_EVENTS_URL = `${EVENTS_URL}&signature=signed-secret`;
const MAX_EVENT_BYTES = 10 * 1024 * 1024;

function mockMeeting(teamId = TEAM_ID) {
  select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockResolvedValue([{ teamId }]),
      }),
    }),
  });
}

function mockMissingMeeting() {
  select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

function mockExistingObjectKeys(objectKeys: string[] = []) {
  mockExistingAssets(
    objectKeys.map((objectKey) => ({
      bucket: "recordings",
      objectKey,
    })),
  );
}

function mockExistingAssets(
  assets: Array<{ bucket: string; objectKey: string }>,
) {
  select.mockReturnValueOnce({
    from: () => ({
      where: vi.fn((condition: SQL) => {
        const query = new PgDialect().sqlToQuery(condition);
        const scopesCurrentBucket =
          query.sql.includes('"media_assets"."bucket" =') &&
          query.params.includes("recordings");
        const matchingAssets = scopesCurrentBucket
          ? assets.filter((asset) => asset.bucket === "recordings")
          : assets;

        return Promise.resolve(
          matchingAssets.map((asset) => ({ objectKey: asset.objectKey })),
        );
      }),
    }),
  });
}

function mockArtifacts(
  participantEventsUrl = EVENTS_URL,
) {
  const bot = { id: "bot_123" };
  retrieveRecallBot.mockResolvedValue(bot);
  findRecallVideoFrameArtifacts.mockReturnValue({
    participantEventsUrl,
    recordingStartedAt: RECORDING_STARTED_AT,
    videoUrl: VIDEO_URL,
  });
  probeVideoDurationMs.mockResolvedValue(12_000);
  return bot;
}

function stubEventResponse(body: BodyInit, headers?: HeadersInit) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(body, {
        headers,
        status: 200,
      }),
    ),
  );
}

function stubR2Env() {
  vi.stubEnv("R2_ACCOUNT_ID", "account");
  vi.stubEnv("R2_ACCESS_KEY_ID", "access");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "recordings");
}

async function persist() {
  const { persistRecallMeetingVideoFrames } = await import(
    "@/lib/meeting-video-frames"
  );

  return persistRecallMeetingVideoFrames({
    meetingId: MEETING_ID,
    recallBotId: "bot_123",
    recallRecordingId: RECORDING_ID,
  });
}

describe("persistRecallMeetingVideoFrames", () => {
  beforeEach(() => {
    stubR2Env();
  });

  afterEach(() => {
    analyzeStableVisualFrames.mockReset();
    extractJpegFrame.mockReset();
    findRecallVideoFrameArtifacts.mockReset();
    insert.mockReset();
    probeVideoDurationMs.mockReset();
    putObject.mockReset();
    retrieveRecallBot.mockReset();
    sampleScreenShareFrames.mockReset();
    select.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("persists two unique frames with exact metadata and duplicate count", async () => {
    mockMeeting();
    const bot = mockArtifacts();
    mockExistingObjectKeys();
    stubEventResponse(
      JSON.stringify([
        {
          action: "screenshare_on",
          participant: { id: "participant_1" },
          timestamp: { relative: 1 },
        },
        {
          action: "screenshare_off",
          participant: { id: "participant_1" },
          timestamp: { relative: 10 },
        },
      ]),
      { "content-type": "application/json" },
    );
    const sampledFrames = [{ pixels: new Uint8Array([0]), timestampMs: 1_000 }];
    sampleScreenShareFrames.mockResolvedValue(sampledFrames);
    analyzeStableVisualFrames.mockReturnValue({
      duplicateCount: 1,
      timestamps: [3_000.4, 7_000],
    });
    extractJpegFrame
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockResolvedValueOnce(new Uint8Array([4, 5, 6, 7]));
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    insert.mockReturnValue({ values });
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await expect(persist()).resolves.toEqual({
      duplicateCount: 1,
      frameCount: 2,
      intervalCount: 1,
    });

    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(findRecallVideoFrameArtifacts).toHaveBeenCalledWith(
      bot,
      RECORDING_ID,
    );
    expect(probeVideoDurationMs).toHaveBeenCalledWith(VIDEO_URL);
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(fetch).toHaveBeenCalledWith(EVENTS_URL, {
      credentials: "omit",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(sampleScreenShareFrames).toHaveBeenCalledWith({
      intervals: [{ startMs: 1_000, endMs: 10_000 }],
      videoUrl: VIDEO_URL,
    });
    expect(analyzeStableVisualFrames).toHaveBeenCalledWith(sampledFrames);
    expect(extractJpegFrame.mock.calls).toEqual([
      [{ timestampMs: 3_000, videoUrl: VIDEO_URL }],
      [{ timestampMs: 7_000, videoUrl: VIDEO_URL }],
    ]);

    const firstKey =
      "teams/team_123/meetings/meeting_123/assets/recall-recording_123-screen-share-v1-3000.jpg";
    const secondKey =
      "teams/team_123/meetings/meeting_123/assets/recall-recording_123-screen-share-v1-7000.jpg";
    expect(putObject.mock.calls).toEqual([
      [
        {
          body: new Uint8Array([1, 2, 3]),
          contentType: "image/jpeg",
          key: firstKey,
        },
      ],
      [
        {
          body: new Uint8Array([4, 5, 6, 7]),
          contentType: "image/jpeg",
          key: secondKey,
        },
      ],
    ]);
    expect(values.mock.calls).toEqual([
      [
        {
          bucket: "recordings",
          capturedAt: new Date("2026-07-10T10:00:03.000Z"),
          checksum:
            "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          fileSizeBytes: 3,
          meetingId: MEETING_ID,
          mimeType: "image/jpeg",
          objectKey: firstKey,
          source: "recall",
          timestampMs: 3_000,
          type: "video_frame",
        },
      ],
      [
        {
          bucket: "recordings",
          capturedAt: new Date("2026-07-10T10:00:07.000Z"),
          checksum:
            "c6d44cf418f610e3fe9e1d9294ff43def81c6cdcad6cbb1820cff48d3aa4355d",
          fileSizeBytes: 4,
          meetingId: MEETING_ID,
          mimeType: "image/jpeg",
          objectKey: secondKey,
          source: "recall",
          timestampMs: 7_000,
          type: "video_frame",
        },
      ],
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
    for (const [conflict] of onConflictDoNothing.mock.calls) {
      expect(conflict).toEqual({
        target: [mediaAssets.bucket, mediaAssets.objectKey],
      });
    }
  });

  it("returns zero for valid events without screen sharing", async () => {
    mockMeeting();
    mockArtifacts();
    stubEventResponse("[]");

    await expect(persist()).resolves.toEqual({
      duplicateCount: 0,
      frameCount: 0,
      intervalCount: 0,
    });

    expect(sampleScreenShareFrames).not.toHaveBeenCalled();
    expect(analyzeStableVisualFrames).not.toHaveBeenCalled();
    expect(extractJpegFrame).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws a sanitized error for malformed event JSON", async () => {
    mockMeeting();
    mockArtifacts();
    stubEventResponse("{not-json");

    const error = await persist().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("valid JSON");
    expect((error as Error).message).not.toContain("event-secret");
  });

  it("sanitizes participant event response stream failures", async () => {
    mockMeeting();
    mockArtifacts();
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error(`stream failed for ${EVENTS_URL}`));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );

    const error = await persist().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unable to read Recall participant events",
    );
    expect((error as Error).message).not.toContain("event-secret");
  });

  it("throws a sanitized error for a non-ok participant event response", async () => {
    mockMeeting();
    mockArtifacts(SIGNED_EVENTS_URL);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );

    const error = await persist().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Recall participant events request failed",
    );
    expect((error as Error).message).not.toContain("https://");
    expect((error as Error).message).not.toContain("?");
    expect((error as Error).message).not.toContain("signature");
  });

  it("rejects an HTTP participant events URL before fetching it", async () => {
    mockMeeting();
    mockArtifacts("http://us-east-1.recall.ai/events.json?signature=secret");
    vi.stubGlobal("fetch", vi.fn());

    const error = await persist().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Recall participant events URL is unsafe",
    );
    expect((error as Error).message).not.toContain("signature");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sanitizes a rejected fetch error containing the signed URL", async () => {
    mockMeeting();
    mockArtifacts(SIGNED_EVENTS_URL);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new Error(`request failed for ${SIGNED_EVENTS_URL}`),
      ),
    );

    const error = await persist().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Unable to fetch Recall participant events",
    );
    expect((error as Error).message).not.toContain("https://");
    expect((error as Error).message).not.toContain("?");
    expect((error as Error).message).not.toContain("signature");
    expect((error as Error).message).not.toContain("signed-secret");
  });

  it("rejects an unsafe participant events URL without fetching it", async () => {
    mockMeeting();
    mockArtifacts("https://evil.example.com/events.json?token=event-secret");
    vi.stubGlobal("fetch", vi.fn());

    const error = await persist().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("unsafe");
    expect((error as Error).message).not.toContain("event-secret");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "declared Content-Length",
      response: () =>
        new Response("[]", {
          headers: { "content-length": String(MAX_EVENT_BYTES + 1) },
          status: 200,
        }),
    },
    {
      name: "actual body size",
      response: () =>
        new Response(new Uint8Array(MAX_EVENT_BYTES + 1), { status: 200 }),
    },
  ])("rejects an oversized event response by $name", async ({ response }) => {
    mockMeeting();
    mockArtifacts();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));

    const error = await persist().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("too large");
    expect((error as Error).message).not.toContain("event-secret");
  });

  it("throws when the meeting does not exist", async () => {
    mockMissingMeeting();

    await expect(persist()).rejects.toThrow("Meeting not found");
    expect(retrieveRecallBot).not.toHaveBeenCalled();
  });

  it("throws a sanitized error when exact recording artifacts are absent", async () => {
    mockMeeting();
    const bot = { signedUrl: EVENTS_URL };
    retrieveRecallBot.mockResolvedValue(bot);
    findRecallVideoFrameArtifacts.mockReturnValue(null);

    const error = await persist().catch((value: unknown) => value);

    expect(findRecallVideoFrameArtifacts).toHaveBeenCalledWith(
      bot,
      RECORDING_ID,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Recall video frame artifacts are unavailable",
    );
    expect((error as Error).message).not.toContain("event-secret");
    expect(probeVideoDurationMs).not.toHaveBeenCalled();
  });

  it("counts an existing exact object key without extracting or uploading it", async () => {
    mockMeeting();
    mockArtifacts();
    const existingKey =
      "teams/team_123/meetings/meeting_123/assets/recall-recording_123-screen-share-v1-3000.jpg";
    mockExistingObjectKeys([existingKey]);
    stubEventResponse(
      JSON.stringify([
        {
          action: "screenshare_on",
          participant: { id: 1 },
          timestamp: { relative: 0 },
        },
        {
          action: "screenshare_off",
          participant: { id: 1 },
          timestamp: { relative: 10 },
        },
      ]),
    );
    sampleScreenShareFrames.mockResolvedValue([]);
    analyzeStableVisualFrames.mockReturnValue({
      duplicateCount: 1,
      timestamps: [3_000, 7_000],
    });
    extractJpegFrame.mockResolvedValue(new Uint8Array([4, 5, 6, 7]));
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    insert.mockReturnValue({ values });

    await expect(persist()).resolves.toEqual({
      duplicateCount: 1,
      frameCount: 2,
      intervalCount: 1,
    });

    expect(extractJpegFrame).toHaveBeenCalledTimes(1);
    expect(extractJpegFrame).toHaveBeenCalledWith({
      timestampMs: 7_000,
      videoUrl: VIDEO_URL,
    });
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
  });

  it("extracts and uploads when the exact object key exists only in another bucket", async () => {
    mockMeeting();
    mockArtifacts();
    const objectKey =
      "teams/team_123/meetings/meeting_123/assets/recall-recording_123-screen-share-v1-3000.jpg";
    mockExistingAssets([{ bucket: "old-bucket", objectKey }]);
    stubEventResponse(
      JSON.stringify([
        {
          action: "screenshare_on",
          participant: { id: 1 },
          timestamp: { relative: 0 },
        },
        {
          action: "screenshare_off",
          participant: { id: 1 },
          timestamp: { relative: 10 },
        },
      ]),
    );
    sampleScreenShareFrames.mockResolvedValue([]);
    analyzeStableVisualFrames.mockReturnValue({
      duplicateCount: 0,
      timestamps: [3_000],
    });
    const jpeg = new Uint8Array([1, 2, 3]);
    extractJpegFrame.mockResolvedValue(jpeg);
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    insert.mockReturnValue({ values });

    await expect(persist()).resolves.toEqual({
      duplicateCount: 0,
      frameCount: 1,
      intervalCount: 1,
    });

    expect(extractJpegFrame).toHaveBeenCalledWith({
      timestampMs: 3_000,
      videoUrl: VIDEO_URL,
    });
    expect(putObject).toHaveBeenCalledWith({
      body: jpeg,
      contentType: "image/jpeg",
      key: objectKey,
    });
    expect(values).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsafe recording ID before external work", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { persistRecallMeetingVideoFrames } = await import(
      "@/lib/meeting-video-frames"
    );

    await expect(
      persistRecallMeetingVideoFrames({
        meetingId: MEETING_ID,
        recallBotId: "bot_123",
        recallRecordingId: "recording/../../secret",
      }),
    ).rejects.toThrow("Unsafe object key segment: recallRecordingId");

    expect(select).not.toHaveBeenCalled();
    expect(retrieveRecallBot).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
