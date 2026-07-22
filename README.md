<p align="center">
  <img src="public/brand/tape-lockup.svg" alt="Tape logo" width="270">
</p>

# Tape

Tape captures team conversations from Google Meet, Zoom, uploaded media, phone recording, or the macOS recorder and turns them into searchable, shareable meeting records.

This repository is source available for noncommercial use. See [License](#license) before using or redistributing it.

## Product Tour

### Find and manage meetings

The dashboard combines weekly activity, calendar capture status, and a searchable meeting library. Users can filter by meeting state, choose the search scope and sort order, save a default view, browse older history, and open related meetings.

<p align="center">
  <img src="assets/product/meeting-hub.png" alt="Tape dashboard with calendar capture and the searchable meeting library" width="900">
</p>

### Review the complete record

Each meeting brings together its status, synchronized audio, transcript, speaker corrections, workspace configured translation, detected entities, captured screen share images, related meetings, and access controls. Missing or failed content leads to the relevant recovery source instead of an empty transcript.

<p align="center">
  <img src="assets/product/meeting-workspace.png" alt="Tape meeting workspace with transcript, sharing, translation, and related meetings" width="900">
</p>

### Inspect transcript context

The transcript supports raw and polished text, synchronized playback, speaker previews, speaker correction, words per minute context, emotion signals, image timestamps, and per segment translation repair.

<p align="center">
  <img src="assets/product/transcript-review.png" alt="Tape transcript review with playback, speaker controls, translation, and captured images" width="900">
</p>

### Record locally on macOS

The companion recorder captures microphone and system audio when cloud capture misses a meeting. It monitors eligible meetings, verifies permissions, uploads durable recording assets, and attaches the result to the existing meeting.

<p align="center">
  <img src="assets/product/macos-recorder.png" alt="Tape macOS recorder with meeting monitoring, permissions, recording, and upload state" width="405">
</p>

## Core Workflows

### Add a meeting

The New meeting page supports four sources:

1. A Google Meet or Zoom link scheduled through Recall.ai
2. An uploaded audio or video recording
3. Pasted transcript text or a TXT, SRT, or VTT file
4. A focused phone recording flow

Google Calendar can be connected for automatic Recall Calendar V2 capture and repair. The macOS recorder provides a separate fallback for missed cloud recordings.

### Review and export

Meeting owners can rename meetings, correct speakers, start or repair translation, review images at their transcript timestamps, copy transcript text, and export any available combination of transcript text, MP3 audio, and meeting images. Image export returns a ZIP archive.

### Share safely

Workspace members can open workspace meetings. Named users outside the workspace receive explicit meeting access after sign in. Pending email invitations activate when the matching user signs in. Shared only users can read granted transcripts but cannot create, edit, delete, or reshare meetings.

Legacy `/share/[token]` links remain supported, require sign in, and resolve only active, unexpired grants.

## Architecture

| Area | Current implementation |
| --- | --- |
| Web application | Next.js 16 and React 19 on Vercel |
| Authentication | Neon Auth with Google sign in |
| Product data | Neon Postgres with Drizzle migrations |
| Media | Cloudflare R2 with authenticated application routes |
| Cloud meeting capture | Recall.ai bots and Calendar V2 |
| Transcription | ElevenLabs Speech to Text using `scribe_v2` |
| Translation and live answers | OpenRouter, with optional Exa web search for live answers |
| Background work | Inngest functions for transcription, scheduling, translation, reminders, and repair |
| Screen share extraction | A Railway Node worker using ffmpeg and ffprobe |
| Notifications | Optional OneSignal browser and mobile push |
| Vocabulary enrichment | Optional Twenty CRM names and companies |
| Agent access | A separate FastMCP server with caller scoped read only tools |

The database is the source of truth for meetings, access, jobs, and transcript records. Vendor payloads and media URLs do not replace local access checks.

## Documentation

| Document | Purpose |
| --- | --- |
| [Product](PRODUCT.md) | Users, workflows, principles, and success criteria |
| [Design guide](DESIGN.md) | Current interface and content contract |
| [Setup guide](docs/setup.md) | Environment, providers, callbacks, database, and deployment |
| [Testing architecture](docs/testing.md) | Verification layers, commands, and CI gates |
| [MCP API](docs/meeting-note-mcp-api.md) | MCP authentication, tools, safe SQL, and access model |
| [macOS release guide](mac/LocalRecorder/RELEASING.md) | Recorder tagging, packaging, signing, and installation |
| [Contributing](CONTRIBUTING.md) | Contribution and privacy requirements |
| [Security policy](SECURITY.md) | Supported version and private reporting process |

Dated files under `docs/superpowers` are historical design and implementation records. Use the active documents above for current behavior.

## Local Setup

Use Node.js 24 and follow the [setup guide](docs/setup.md) for the complete environment contract.

```bash
git clone https://github.com/glazec/tape.git
cd tape
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Provider backed routes require the corresponding values in `.env.local`.

Run the configuration audit before production deployment:

```bash
npm run setup:check
```

## Deployment

The web application deploys to Vercel. Its production build validates required configuration and migration lineage, applies pending migrations, and then builds the application. Preview builds do not mutate the production database.

The optional image worker deploys separately to Railway. It accepts Inngest requests at `/api/inngest` and exposes `/health` for service health checks.

```bash
npm run build:image-worker
PORT=3001 npm run start:image-worker
curl --fail http://127.0.0.1:3001/health
IMAGE_WORKER_URL=https://your-worker.example npm run inngest:sync:image-worker
```

After deploying or changing `NEXT_PUBLIC_APP_URL`, register the provider callbacks and sync the web Inngest application:

```bash
npm run inngest:sync
```

The [setup guide](docs/setup.md) contains the callback routes, environment variables, local tunnel flow, and production checklist.

## Verification

The portable gate covers lint, Vitest coverage, the production build, the recorder sidecar, and MCP tests:

```bash
npm run verify
```

On macOS, the complete gate also runs Swift and Playwright:

```bash
npm run verify:all
```

The live calendar probe is explicit because it requires a connected account and real provider credentials:

```bash
CALENDAR_LIVE_TEST_EMAIL=user@example.com npm run test:calendar-live
```

See [testing architecture](docs/testing.md) for individual commands, current coverage thresholds, and CI behavior.

## License

This project is source available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use, modification, and distribution are permitted. Commercial use requires a separate license from the project owner.

Because commercial use is restricted, this is not an OSI approved open source license.
