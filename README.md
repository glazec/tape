# Meeting Transcript

Team meeting transcript product.

## Stack

1. Next.js on Vercel
2. Neon Auth for Google OAuth
3. Neon Postgres for product data
4. Cloudflare R2 for media
5. Recall.ai for Google Meet and Zoom capture
6. [ElevenLabs](https://elevenlabs.io) for transcription
7. Inngest style workers for long running jobs
8. OneSignal for browser push subscriptions and meeting reminders
9. [Twenty CRM](https://twenty.com) for optional CRM vocabulary enrichment

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Neon, Google Calendar, R2, Recall, ElevenLabs, Inngest, OneSignal, and optional Twenty CRM credentials. `NEON_AUTH_BASE_URL` is optional when `NEON_AUTH_JWKS_URL` ends with `/.well-known/jwks.json`; generate `NEON_AUTH_COOKIE_SECRET` with `openssl rand -base64 32`.
   Set `RECALL_API_BASE_URL` to the region for the Recall API key, for example `https://ap-northeast-1.recall.ai`.
3. Run `npm install`.
4. Run `npm run dev`.

## Database Migrations

Run [Drizzle](https://orm.drizzle.team) migrations against the target [Neon](https://neon.tech) database before deploying code that uses new schema objects:

```bash
DATABASE_URL=... npm run db:migrate
```

For production, run the migration command with the production `DATABASE_URL`, then deploy the app. If code reaches a new table, column, index, or enum before the migration runs, server rendered pages can fail for signed in users.

## Local Tunnel

The Cloudflare test tunnel is `meeting-note-dev.inevitable.tech`. It points to `http://localhost:3000` and is suitable for Google OAuth redirects plus Recall and ElevenLabs webhooks during local testing.

1. Set `NEXT_PUBLIC_APP_URL=https://meeting-note-dev.inevitable.tech` in `.env.local`.
2. Run `npm run dev`.
3. In another terminal, run `CLOUDFLARED_TOKEN=... ./scripts/dev-tunnel.sh`.
4. Run `npm run inngest:sync` after the tunnel is reachable so Inngest can register `/api/inngest`.

Local test webhook URLs:

1. `https://meeting-note-dev.inevitable.tech/api/recall/webhook`
2. `https://meeting-note-dev.inevitable.tech/api/recall/calendar/webhook`
3. `https://meeting-note-dev.inevitable.tech/api/elevenlabs/webhook`

## Auth

The app uses Neon Auth through the official Next.js SDK. Browser auth requests are proxied through `/api/auth/[...path]`, the landing page routes users to `/auth/sign-in`, and server code reads the current user from Neon Auth sessions instead of a hand rolled JWT cookie.
Dashboard, meeting transcript, and team settings pages require an authenticated session. Anonymous visitors are redirected to `/auth/sign-in`.
The sign out button calls the Neon Auth client sign out method, then posts to `/api/sign-out` to expire local Neon Auth cookies as a cleanup fallback.

## Push Notifications

The production OneSignal web app is configured for `https://meeting-note-swart.vercel.app` with app id `117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef`. The client uses that app id by default and `NEXT_PUBLIC_ONESIGNAL_APP_ID` can override it for another OneSignal app. The browser SDK only initializes on `NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS`, which defaults to the production origin, so local development does not call the production OneSignal app. Set `ONESIGNAL_REST_API_KEY` in server environments so the reminder worker can send push notifications.

The required service worker from the OneSignal v16 package is served from `/OneSignalSDKWorker.js`, and the SDK init points to that root worker path. Signed in app pages identify the browser to OneSignal with the local workspace user id. OneSignal controls the visible permission prompt from its dashboard, so the product can keep reminder setup out of the normal meeting UI.

Location based calendar events create an in person meeting row and a reminder scheduled for two minutes before the event. Run the `meeting/send.location-reminders` worker event from a scheduler every minute, or wire the same helper to an Inngest cron, so due mobile reminders are delivered through OneSignal native iOS and Android push only.

## Dashboard

The authenticated dashboard is a meeting operations hub for investors and team operators. It shows global workspace coverage before the meeting table:

1. Upcoming joins counts scheduled future meetings that already have a Recall bot.
2. Ready for review counts meetings with completed transcripts.
3. Needs attention counts failed meetings, stale scheduled meetings, and future scheduled meetings without a bot.

The Calendar automation panel shows whether Recall Calendar is connected, whether team bot coverage is on, when the calendar was last checked, and the Sync Recall calendar repair action. Normal calendar capture is driven by Recall Calendar V2 webhooks, so users should not need to click Sync calendar for every new event.

The Meeting library remains the searchable recent meeting table. It is filtered by the search box and capped for browsing, while the dashboard summary is computed separately from all workspace meetings in Neon so search does not hide bot coverage or exception counts. Scheduled rows show whether a bot is linked, recording rows show that the bot is in the meeting, and failed rows are marked for review. Related rows are grouped by shared external attendee emails, while smart order folds repeated stable meeting titles. Extracted entities remain visible search context instead of grouping evidence.

## Meeting Links

The new meeting page posts Google Meet and Zoom links to `/api/meetings/link`. The route requires an authenticated Neon Auth session, rejects unsupported meeting hosts, creates a local meeting row, and schedules a Recall bot with `/api/recall/webhook` as the callback URL. The Recall bot receives the local `meetingId` in metadata so later webhooks can update the same meeting.

Google sign in identifies the user through Neon Auth, so keep the Neon Auth Google redirect URI configured for sign in. Calendar permission is owned by Recall Calendar V2, not by this app. Connect the Google Calendar account in Recall, then store `https://meeting-note-swart.vercel.app/api/recall/calendar/webhook` in the Recall dashboard as the Calendar V2 webhook endpoint for production. Use the local tunnel URL above for local testing.

The dashboard adopts a connected Recall Calendar automatically when the Recall calendar metadata matches the workspace, or when the Recall account has exactly one connected Google Calendar. The app stores only the Recall Calendar V2 id and status in Neon on `calendar_connections`. It does not need `GOOGLE_CALENDAR_CLIENT_ID` or `GOOGLE_CALENDAR_CLIENT_SECRET`.

Recall Calendar V2 sends `calendar.sync_events` webhooks when calendar events are created, updated, or deleted. The webhook route verifies the Recall signature, deduplicates delivery, fetches changed Recall calendar events, stores the Neon `calendar_events` row, then applies the existing auto join policy. Supported Google Meet and Zoom events are scheduled through Recall Calendar V2 with `meetingId` plus `calendarEventId` metadata. Shared calendar events use a team scoped `deduplication_key` and the Neon `meetings.team_meeting_key` unique index so one team meeting gets one bot.

`/api/calendar/sync` remains as a repair action. It no longer reads Google Calendar events directly. It finds the connected Recall calendar in Neon, lists upcoming Recall Calendar V2 events, stores Neon event and meeting rows, then schedules Recall Calendar V2 bots for eligible Google Meet or Zoom events.

When Recall reports a completed recording, the webhook handler retrieves the bot, reads the recording media download URL, creates a local ElevenLabs transcript job, and queues `meeting/transcribe.audio` with that URL. Meeting pages can play Recall recording audio through the authenticated meeting audio route once Recall exposes the recording media.
The same completion flow also imports available Recall screenshots into R2 as meeting image assets. Meeting pages show captured images above the transcript, with image preview and jump to transcript controls for timestamped review.

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

Inngest events do not register functions by themselves. After deploying the app or changing `NEXT_PUBLIC_APP_URL`, run `npm run inngest:sync` to sync the public `/api/inngest` endpoint. If this sync is missing, upload rows can be created while transcript jobs stay queued with no ElevenLabs provider job id. Calendar event scheduling does not depend on Inngest; it is driven by Recall Calendar V2 reconciliation and webhooks.

## Verification

```bash
npm run lint
npm run test
npm run build
npx playwright test
```
