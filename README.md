# Tape

Tape captures team conversations from Google Meet, Zoom, or the macOS recorder and turns them into searchable, shareable meeting records. It combines calendar based capture, speaker aware transcripts, translation, detected entities, synchronized playback, and screen share images in one review workflow.

This repository is source available for noncommercial use. See [License](#license) before using or redistributing it.

## Product Tour

### Manage every meeting from one hub

Connect a calendar to schedule automatic meeting joins, monitor recording coverage, review team activity, and find meetings by company, founder, speaker, or transcript content.

<p align="center">
  <img src="assets/product/meeting-hub.png" alt="Meeting hub with calendar capture, upcoming joins, team activity, and the searchable meeting library" width="900">
</p>

### Review the complete meeting record

Each meeting brings together access controls, detected entities, translation status, captured screen share images, and synchronized audio playback.

<p align="center">
  <img src="assets/product/meeting-workspace.png" alt="Meeting workspace with detected entities, sharing, translation, screen share images, and synchronized playback" width="900">
</p>

### Inspect speakers, transcript, and visual context

Review speaker participation, correct speaker names, play individual contributions, compare translated text with the original transcript, and revisit captured visuals at their meeting timestamps.

<p align="center">
  <img src="assets/product/transcript-review.png" alt="Transcript review with meeting images, speaker controls, translated text, and original transcript text" width="900">
</p>

### Record locally on macOS

The companion recorder captures microphone and system audio, shows the next calendar meeting, verifies permissions, and lets the user confirm audio levels before recording.

<p align="center">
  <img src="assets/product/macos-recorder.png" alt="Tape macOS recorder with the next meeting, recording control, permissions, and audio level checks" width="405">
</p>

## Documentation

1. [Setup guide](docs/setup.md)
2. [Contributing](CONTRIBUTING.md)
3. [Security policy](SECURITY.md)
4. [Tape MCP API](docs/meeting-note-mcp-api.md)

## Stack

1. [Next.js](https://nextjs.org) on [Vercel](https://vercel.com)
2. [Neon Auth](https://neon.com/docs/auth/overview) for Google OAuth
3. [Neon Postgres](https://neon.tech) for product data
4. [Cloudflare R2](https://developers.cloudflare.com/r2/) for media
5. [Recall.ai](https://www.recall.ai/) for Google Meet and Zoom capture
6. [ElevenLabs](https://elevenlabs.io) for transcription
7. [OpenRouter](https://openrouter.ai) for live chat answers and transcript translation
8. [Inngest](https://www.inngest.com) style workers for long running jobs
9. [OneSignal](https://onesignal.com) for browser push subscriptions and meeting reminders
10. [Twenty CRM](https://twenty.com) for optional CRM vocabulary enrichment

## Local Setup

Use the [setup guide](docs/setup.md) for prerequisites, environment variables, database migration, webhooks, local development, and macOS recorder setup.

```bash
git clone https://github.com/glazec/tape.git
cd tape
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

The application validates required provider configuration at runtime. Complete `.env.local` before opening routes that use those providers.

## Agent Setup Interview

Use this flow when a coding agent helps a human create `.env.local`.

1. Ask about one provider at a time.
2. For each provider, explain what the app currently uses, what feature is needed, where to get the key, and which env names will be filled.
3. Let the human choose the current provider, skip an optional provider, or explore another provider.
4. If the human names another provider, compare tradeoffs before changing code. Cover product fit, setup work, pricing shape, webhook support, data retention, region support, and migration risk.
5. If the human still wants the new provider, write a provider replacement note and continue the remaining provider questions.
6. Finish all provider questions first. Only then update `.env.local`, change adapters if needed, update `.env.example`, run migrations if schema changed, and run verification.
7. Never print secrets back to the user. Confirm only that a value was received.

Provider replacement note format:

```text
Area:
Current provider:
Requested provider:
Decision:
Required env names:
Files that need migration:
Verification plan:
```

Ask these questions in order.

1. [Neon](https://neon.tech) database and auth

   The app uses Neon Postgres for product data and Neon Auth for Google sign in. Get the database URL from the Neon project connection string. Get the auth URL and issuer from Neon Auth configuration. Generate the cookie secret locally with `openssl rand -base64 32`.

   Prompt: Please provide `DATABASE_URL`, `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, and `NEON_AUTH_COOKIE_SECRET`, or tell me if you want to use another database or auth provider.

2. [Cloudflare R2](https://developers.cloudflare.com/r2/) media storage

   The app stores uploaded MP3 files, Recall recordings, screenshots, and generated meeting media in R2 through the S3 compatible API. Get the account id, bucket name, access key id, and secret access key from the Cloudflare R2 dashboard.

   Prompt: Please provide `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`. `R2_PUBLIC_BASE_URL` is optional. If you want S3, GCS, or another object store, tell me the provider name and I will compare the migration cost.

3. [Recall.ai](https://www.recall.ai/) meeting capture

   The app uses Recall.ai to schedule bots for Google Meet and Zoom, connect Recall Calendar V2, receive bot status webhooks, receive Calendar V2 webhooks, retrieve recording media, import screenshots, and receive realtime meeting chat events. Create an API key in the Recall dashboard for the same region as `RECALL_API_BASE_URL`. Create a workspace verification secret for webhook signatures.

   Prompt: Please provide `RECALL_API_KEY`, `RECALL_API_BASE_URL`, and `RECALL_WEBHOOK_SECRET`, or name another meeting capture provider.

4. [ElevenLabs](https://elevenlabs.io) transcription

   The app uses ElevenLabs Speech to Text at `POST https://api.elevenlabs.io/v1/speech-to-text`. The current request uses model `scribe_v2`, async webhooks, diarization, entity detection, word timestamps, source URL input, webhook metadata, and team vocabulary keyterms. Get the API key from [ElevenLabs API keys](https://elevenlabs.io/app/developers/api-keys). Create or inspect the ElevenLabs workspace webhook and store its signing secret.

   Prompt: For transcription, we currently use ElevenLabs Speech to Text with `scribe_v2`, diarization, word timestamps, entity detection, async webhooks, and keyterms. Please provide `ELEVENLABS_API_KEY` and `ELEVENLABS_WEBHOOK_SECRET`, or tell me another transcription provider to compare. If you choose another provider, I will explain the tradeoffs and, if you confirm, migrate `lib/vendors/elevenlabs.ts`, `app/api/elevenlabs/webhook/route.ts`, `lib/elevenlabs-transcripts.ts`, `lib/transcription-records.ts`, and the `meeting/transcribe.audio` worker after all provider questions are complete.

5. [OpenRouter](https://openrouter.ai) model calls

   The app uses OpenRouter chat completions for live Recall chat answers and transcript translation. The default model is `qwen/qwen3.7-plus` in `.env.example`. Create a key in [OpenRouter keys](https://openrouter.ai/settings/keys), then keep the model slug explicit. Live meeting answers can use [Exa](https://exa.ai) for grounded web search when `EXA_API_KEY` is configured. Without that key, the search tool stays disabled.

   Prompt: Please provide `OPENROUTER_API_KEY`, confirm `OPENROUTER_MODEL=qwen/qwen3.7-plus`, and provide `EXA_API_KEY` if the meeting agent should search the web. You can also name another model gateway or search provider.

6. [Inngest](https://www.inngest.com) workers

   The app uses Inngest for `meeting/transcribe.audio`, `meeting/schedule.bot`, transcript enrichment, location reminders, and hourly Recall Calendar repair. Create an event key for sending events and get the environment signing key for secure function sync.

   Prompt: Please provide `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, or tell me if you want another background job system.

7. [OneSignal](https://onesignal.com) push notifications

   The app uses OneSignal for browser push subscriptions and location based meeting reminders. This can be skipped for a local transcript only setup. Get the app id and app API key from OneSignal Settings, Keys and IDs.

   Prompt: Do you want push reminders enabled now? If yes, please provide `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS`, and `ONESIGNAL_REST_API_KEY`. If no, I will leave the default app id and note reminders as not configured for this environment.

8. [Twenty CRM](https://twenty.com) vocabulary enrichment

   Twenty CRM is optional. When configured, the app reads people and company names through Twenty GraphQL and sends them to ElevenLabs as transcription keyterms after manual team vocabulary.

   Prompt: Do you want Twenty CRM vocabulary enrichment? If yes, please provide `TWENTY_API_BASE_URL` and `TWENTY_API_KEY`. If no, transcription still works with manual team vocabulary.

9. Local tunnel

   Local Recall, ElevenLabs, and Inngest webhook testing needs a public app URL. This repo uses a Cloudflare tunnel through `./scripts/dev-tunnel.sh`.

   Prompt: For local webhook testing, please provide `CLOUDFLARED_TOKEN` or confirm you will use another stable tunnel URL. Then set `NEXT_PUBLIC_APP_URL` to that public origin.

## Database Migrations

Run [Drizzle](https://orm.drizzle.team) migrations against the target [Neon](https://neon.tech) database before deploying code that uses new schema objects:

```bash
DATABASE_URL=... npm run db:migrate
```

For production, run the migration command with the production `DATABASE_URL`, then deploy the app. If code reaches a new table, column, index, or enum before the migration runs, server rendered pages can fail for signed in users.

## Image Worker

The web application remains on [Vercel](https://vercel.com). A separate [Railway](https://railway.com) service runs ffmpeg after Recall recording completion and stores stable shared screen frames in Cloudflare R2. The worker accepts only Inngest requests at `/api/inngest`; `/health` is its public health check.

Railway requires these variables:

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

Build and run the worker locally:

```bash
npm run build:image-worker
PORT=3001 npm run start:image-worker
curl --fail http://127.0.0.1:3001/health
```

`Dockerfile.image-worker` installs ffmpeg and builds the Node worker. `railway.json` configures the Dockerfile, `/health`, and restart policy. After Railway assigns a public domain, register only this worker app with Inngest:

```bash
IMAGE_WORKER_URL=https://your-worker-domain npm run inngest:sync:image-worker
```

The extraction function has concurrency one and two retries. In the Railway dashboard, enable Serverless and set the service memory limit to 1 GB. A 10 dollar monthly workspace hard limit is appropriate only when this worker has a dedicated Railway workspace. On a shared workspace, use project usage alerts instead because a workspace hard limit can suspend unrelated services. Do not move the Next.js web service from Vercel to Railway.

## Local Tunnel

Production uses `https://meeting-note-swart.vercel.app` as `NEXT_PUBLIC_APP_URL`. Do not use a local tunnel URL for production callbacks.

The Cloudflare test tunnel is `meeting-note-dev.inevitable.tech`. It points to `http://localhost:3000` and is suitable for Google OAuth redirects plus Recall and ElevenLabs webhooks only while the local tunnel is healthy.

1. Set `NEXT_PUBLIC_APP_URL=https://meeting-note-dev.inevitable.tech` in `.env.local`.
2. Run `npm run dev`.
3. In another terminal, run `CLOUDFLARED_TOKEN=... ./scripts/dev-tunnel.sh`.
4. Verify the tunnel before using it for callbacks:

```bash
curl -I https://meeting-note-dev.inevitable.tech/api/recall/realtime/webhook
```

The expected response is `405 Method Not Allowed` for `GET`, or `401 Invalid webhook signature` for an unsigned `POST`. Cloudflare `530` means the tunnel is not usable.

5. Run `npm run inngest:sync` after the tunnel is reachable so Inngest can register `/api/inngest`.

Local test webhook URLs:

1. `https://meeting-note-dev.inevitable.tech/api/recall/webhook`
2. `https://meeting-note-dev.inevitable.tech/api/recall/calendar/webhook`
3. `https://meeting-note-dev.inevitable.tech/api/recall/realtime/webhook`
4. `https://meeting-note-dev.inevitable.tech/api/elevenlabs/webhook`

## Auth

The app uses Neon Auth through the official Next.js SDK. Browser auth requests are proxied through `/api/auth/[...path]`, the landing page routes users to `/auth/sign-in`, and server code reads the current user from Neon Auth sessions instead of a hand rolled JWT cookie.
Dashboard, meeting transcript, and team settings pages require an authenticated session. Anonymous visitors are redirected to `/auth/sign-in`.
The sign out button calls the Neon Auth client sign out method, then posts to `/api/sign-out` to expire local Neon Auth cookies as a cleanup fallback.

## Push Notifications

The production OneSignal web app is configured for `https://meeting-note-swart.vercel.app` with app id `117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef`. The client uses that app id by default and `NEXT_PUBLIC_ONESIGNAL_APP_ID` can override it for another OneSignal app. The browser SDK only initializes on `NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS`, which defaults to the production origin, so local development does not call the production OneSignal app. Set `ONESIGNAL_REST_API_KEY` in server environments so the reminder worker can send push notifications.

The required service worker from the OneSignal v16 package is served from `/OneSignalSDKWorker.js`, and the SDK init points to that root worker path. Signed in app pages identify the browser to OneSignal with the local workspace user id. OneSignal controls the visible permission prompt from its dashboard, so the product can keep reminder setup out of the normal meeting UI.

Location based calendar events create an in person meeting row and a reminder scheduled for two minutes before the event. The `send-location-reminders` Inngest cron checks for due reminders every minute, while the `meeting/send.location-reminders` worker event remains available for manual repair runs. Due mobile reminders are delivered through OneSignal native iOS and Android push only.

## Dashboard

The authenticated dashboard is a meeting operations hub for investors and team operators. It shows global workspace coverage before the meeting table:

1. Upcoming joins counts scheduled future meetings that already have a Recall bot.
2. Ready for review counts meetings with completed transcripts.
3. Needs attention counts failed meetings, stale scheduled meetings, and future scheduled meetings without a bot.

The Calendar automation panel shows whether Recall Calendar is connected, whether team bot coverage is on, when the calendar was last checked, and the Sync Recall calendar repair action. Normal calendar capture is driven by Recall Calendar V2 webhooks, so users should not need to click Sync calendar for every new event.

The Meeting library remains the searchable recent meeting table. It is filtered by the search box and capped for browsing, while the dashboard summary is computed separately from all workspace meetings in Neon so search does not hide bot coverage or exception counts. Scheduled rows show whether a bot is linked, recording rows show that the bot is in the meeting, and failed rows are marked for review. Related rows are grouped by shared external attendee emails, while smart order folds repeated stable meeting titles. Extracted entities remain visible search context instead of grouping evidence.

## Meeting Links

The new meeting page posts Google Meet and Zoom links to `/api/meetings/link`. The route requires an authenticated Neon Auth session, rejects unsupported meeting hosts, creates a local meeting row, and schedules a Recall bot with `/api/recall/webhook` in metadata for status correlation plus `/api/recall/realtime/webhook` in the bot recording config for live chat and participant events. The Recall bot receives the local `meetingId` in metadata so later webhooks can update the same meeting.

Google sign in identifies the user through Neon Auth, so keep the Neon Auth Google redirect URI configured for sign in. Calendar connection uses this app's Google Calendar OAuth client with `/api/calendar/oauth/callback` as the redirect URI. After the callback receives a Google refresh token, the app creates or updates the matching Recall Calendar V2 connection. Store `https://meeting-note-swart.vercel.app/api/recall/calendar/webhook` in the Recall dashboard as the Calendar V2 webhook endpoint for production. Use the local tunnel URL above for local testing.

The dashboard adopts a connected Recall Calendar automatically when the Recall calendar metadata matches the workspace, or when the user completes the app calendar connection flow. The app stores the encrypted Google refresh token plus the Recall Calendar V2 id and status in Neon on `calendar_connections`. The calendar connection route needs `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`.

Recall Calendar V2 sends `calendar.sync_events` webhooks when calendar events are created, updated, or deleted. The webhook route verifies the Recall signature, deduplicates delivery, fetches changed Recall calendar events, stores the Neon `calendar_events` row, then applies the existing auto join policy. Supported Google Meet and Zoom events are scheduled through Recall Calendar V2 with `meetingId` plus `calendarEventId` metadata. Shared calendar events use a team scoped `deduplication_key` and the Neon `meetings.team_meeting_key` unique index so one team meeting gets one bot.

`/api/calendar/sync` remains as a repair action. It no longer reads Google Calendar events directly. It finds the connected Recall calendar in Neon, lists upcoming Recall Calendar V2 events, stores Neon event and meeting rows, then schedules Recall Calendar V2 bots for eligible Google Meet or Zoom events. The `sync-recall-calendars-hourly` Inngest cron runs the same repair sync once per hour for every local user with a connected Recall calendar.

When Recall reports a completed recording, the webhook handler retrieves the bot, reads the recording media download URL, creates a local ElevenLabs transcript job, and queues `meeting/transcribe.audio` with that URL. Meeting pages can play Recall recording audio through the authenticated meeting audio route once Recall exposes the recording media.
The same completion flow independently queues the Railway image worker. It scans only confirmed screen share intervals, keeps every unique visual state that remains stable for two seconds, and writes source resolution JPEG assets to R2 without a meeting level frame limit. Meeting pages show captured images above the transcript, with image preview and jump to transcript controls for timestamped review.

## MP3 Uploads

The upload form requests a signed R2 PUT URL from `/api/upload`, uploads the MP3 directly to R2, then posts the returned `uploadId` to `/api/uploads/complete`. The completion route checks that the R2 object exists, creates local meeting, media asset, and transcript job rows, then queues `meeting/transcribe.audio`. If the browser PUT fails, the form falls back to `/api/uploads/audio`, which stores the MP3 server side and creates the same durable records. The worker creates a short lived R2 read URL, starts an ElevenLabs transcription job, and passes the local record ids as webhook metadata.

## Transcription Vocabulary

Team settings can store names, company names, project names, and fund terms that should be sent to [ElevenLabs](https://elevenlabs.io) as transcription keyterms. These manual team vocabulary entries are always sent first.

If `TWENTY_API_BASE_URL` and `TWENTY_API_KEY` are configured, the app also reads recent people and company names from [Twenty CRM](https://twenty.com) GraphQL and appends them after the manual team vocabulary. Duplicate terms are removed case insensitively, while the manual team setting spelling is preserved. Missing or failing Twenty CRM credentials do not block transcription.

Keyterms are cleaned before each [ElevenLabs](https://elevenlabs.io) request: whitespace is normalized, empty values are removed, terms longer than 50 characters are skipped, and the request is capped at 1000 keyterms. Full names and distinctive organization or project names work better than generic first names.

The R2 bucket must allow browser PUT requests from the app origin:

```json
{
  "rules": [
    {
      "id": "meeting-transcript-browser-uploads",
      "allowed": {
        "origins": [
          "https://meeting-note-swart.vercel.app",
          "https://meeting-note-dev.inevitable.tech",
          "http://localhost:3000"
        ],
        "methods": ["PUT"],
        "headers": ["Content-Type", "content-type"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

## Share Links

Shared transcript pages use `/share/[token]` for legacy token links, but they still require sign in before transcript data is read. The route hashes the URL token, looks up an active `share_links` row, and returns 404 when the token is missing, expired, or revoked.

Meeting transcript pages also support signed in sharing by app URL. Workspace members can open the meeting URL directly, known users outside the workspace can receive direct transcript access, and unknown emails are stored as pending shares that are granted when that person signs in. Shared only users can read transcripts, but they cannot add new meetings.

## Exports

Meeting transcript pages can export transcript text, export MP3 audio through the authenticated audio route, export both files, or copy transcript text to the clipboard.

## Vendor Webhooks

Recall bot status and Calendar V2 webhooks are delivered to endpoints configured in the Recall dashboard. ElevenLabs speech to text webhooks are delivered to workspace configured webhooks when transcript jobs set `webhook=true`. All vendor webhook routes verify vendor signatures from the raw request body before parsing the event, store an idempotency record, and only apply side effects for newly inserted webhook events.

Recall bot status webhooks update the local meeting status when metadata contains a `meetingId`. Recall Calendar V2 webhooks keep scheduled meeting rows in sync without requiring the user to click Sync calendar. Completed Recall recordings store Recall speaker timeline data when available, then queue ElevenLabs transcription when Recall exposes a recording media URL. ElevenLabs webhooks update the local transcript job, store transcript text as transcript segments, map speaker ids to Recall participant names by timestamp, and mark the meeting ready when metadata contains `meetingId` and `transcriptJobId`.

Recall realtime webhook URLs are embedded into each scheduled bot. After changing `NEXT_PUBLIC_APP_URL`, audit future scheduled bots in Recall and patch any `recording_config.realtime_endpoints` entries that still point at the old origin. Updating the environment and redeploying only affects newly created or later updated bots.

Enable retries on the ElevenLabs workspace webhook. The app returns `503` for an unfinished duplicate delivery so the provider can retry after the original processing claim becomes stale, but ElevenLabs retry delivery is controlled by the workspace webhook setting.

Inngest events do not register functions by themselves. After deploying the app or changing `NEXT_PUBLIC_APP_URL`, run `npm run inngest:sync` to sync the public `/api/inngest` endpoint. If this sync is missing, upload rows can be created while transcript jobs stay queued with no ElevenLabs provider job id, and the location reminder plus hourly Recall Calendar repair crons will not be registered. Normal calendar scheduling is still driven by Recall Calendar V2 reconciliation and webhooks.

## Verification

```bash
npm run lint
npm run test
npm run build
npx playwright test
```

## License

This project is source available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Noncommercial use, modification, and distribution are permitted. Commercial use is not permitted without a separate license from the project owner.

Because commercial use is restricted, this is not an OSI approved open source license.
