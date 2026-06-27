# Meeting Transcript

Team meeting transcript product.

## Stack

1. Next.js on Vercel
2. Neon Auth for Google OAuth
3. Neon Postgres for product data
4. Cloudflare R2 for media
5. Recall.ai for Google Meet and Zoom capture
6. ElevenLabs for transcription
7. Inngest style workers for long running jobs
8. OneSignal for browser push subscriptions and meeting reminders

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Neon, Google Calendar, R2, Recall, ElevenLabs, Inngest, and OneSignal credentials. `NEON_AUTH_BASE_URL` is optional when `NEON_AUTH_JWKS_URL` ends with `/.well-known/jwks.json`; generate `NEON_AUTH_COOKIE_SECRET` with `openssl rand -base64 32`.
   Set `RECALL_API_BASE_URL` to the region for the Recall API key, for example `https://ap-northeast-1.recall.ai`.
3. Run `npm install`.
4. Run `npm run dev`.

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

The production OneSignal web app is configured for `https://meeting-note-swart.vercel.app` with app id `117c1d1c-ada4-4b49-bb2e-9f4b5cb747ef`. Set `NEXT_PUBLIC_ONESIGNAL_APP_ID` to that value in Vercel to load the OneSignal Web SDK.

The required service worker is served from `/OneSignalSDKWorker.js`. OneSignal controls the visible permission prompt from its dashboard, so the product can keep reminder setup out of the normal meeting UI.

## Dashboard

The authenticated dashboard is a meeting operations hub for investors and team operators. It shows global workspace coverage before the meeting table:

1. Upcoming joins counts scheduled future meetings that already have a Recall bot.
2. Ready for review counts meetings with completed transcripts.
3. Needs attention counts failed meetings, stale scheduled meetings, and future scheduled meetings without a bot.

The Calendar automation panel shows whether Recall Calendar is connected, whether team bot coverage is on, when the calendar was last checked, and the Sync Recall calendar repair action. Normal calendar capture is driven by Recall Calendar V2 webhooks, so users should not need to click Sync calendar for every new event.

The Meeting library remains the searchable recent meeting table. It is filtered by the search box and capped for browsing, while the dashboard summary is computed separately from all workspace meetings in Neon so search does not hide bot coverage or exception counts. Scheduled rows show whether a bot is linked, recording rows show that the bot is in the meeting, and failed rows are marked for review.

## Meeting Links

The new meeting page posts Google Meet and Zoom links to `/api/meetings/link`. The route requires an authenticated Neon Auth session, rejects unsupported meeting hosts, creates a local meeting row, and schedules a Recall bot with `/api/recall/webhook` as the callback URL. The Recall bot receives the local `meetingId` in metadata so later webhooks can update the same meeting.

Google sign in identifies the user through Neon Auth, so keep the Neon Auth Google redirect URI configured for sign in. Google Calendar permission is handled by the app owned OAuth flow at `/api/calendar/oauth/start` and `/api/calendar/oauth/callback`, because calendar scopes are separate from identity sign in. Add these app callback redirect URIs to the same Google OAuth client:

1. `https://meeting-note-swart.vercel.app/api/calendar/oauth/callback`
2. `https://meeting-note-dev.inevitable.tech/api/calendar/oauth/callback`
3. `http://localhost:3000/api/calendar/oauth/callback`

Google Calendar OAuth setup checklist:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), open the OAuth client whose client ID is stored in `GOOGLE_CALENDAR_CLIENT_ID`.
2. The client type must be Web application.
3. Add every app callback above under Authorized redirect URIs. Authorized JavaScript origins are not enough.
4. The callback URI must match exactly. Do not add a trailing slash.
5. Store the client ID and client secret in Vercel as `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`, then redeploy production so the serverless functions receive the new values.
6. Run database migrations before testing Calendar sync. Calendar connections store encrypted Google OAuth token columns plus the Recall Calendar V2 id in Neon on `calendar_connections`.

If Google shows `Error 400: redirect_uri_mismatch`, the app has reached Google successfully but the OAuth client is missing the exact callback URI. Check the `redirect_uri` value in the Google error details and add that exact value to Authorized redirect URIs on the same OAuth client.

When Google Calendar OAuth succeeds, the app stores the encrypted Google tokens in Neon, creates or updates a Recall Calendar V2 calendar with the Google refresh token, then immediately reconciles upcoming Recall calendar events. Store `https://meeting-note-swart.vercel.app/api/recall/calendar/webhook` in the Recall dashboard as the Calendar V2 webhook endpoint for production, and use the local tunnel URL above for local testing.

Recall Calendar V2 sends `calendar.sync_events` webhooks when calendar events are created, updated, or deleted. The webhook route verifies the Recall signature, deduplicates delivery, fetches changed Recall calendar events, stores the Neon `calendar_events` row, then applies the existing auto join policy. Supported Google Meet and Zoom events are scheduled through Recall Calendar V2 with `meetingId` plus `calendarEventId` metadata. Shared calendar events use a team scoped `deduplication_key` and the Neon `meetings.team_meeting_key` unique index so one team meeting gets one bot.

`/api/calendar/sync` remains as a repair action. It no longer reads Google Calendar events directly. It finds the connected Recall calendar in Neon, lists upcoming Recall Calendar V2 events, stores Neon event and meeting rows, then schedules Recall Calendar V2 bots for eligible Google Meet or Zoom events.

When Recall reports a completed recording, the webhook handler retrieves the bot, reads the recording media download URL, creates a local ElevenLabs transcript job, and queues `meeting/transcribe.audio` with that URL. Meeting pages can play Recall recording audio through the authenticated meeting audio route once Recall exposes the recording media.

## MP3 Uploads

The upload form requests a signed R2 PUT URL from `/api/upload`, uploads the MP3 directly to R2, then posts the returned `uploadId` to `/api/uploads/complete`. The completion route checks that the R2 object exists, creates local meeting, media asset, and transcript job rows, then queues `meeting/transcribe.audio`. If the browser PUT fails, the form falls back to `/api/uploads/audio`, which stores the MP3 server side and creates the same durable records. The worker creates a short lived R2 read URL, starts an ElevenLabs transcription job, and passes the local record ids as webhook metadata.

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

Recall bot status webhooks update the local meeting status when metadata contains a `meetingId`. Recall Calendar V2 webhooks keep scheduled meeting rows in sync without requiring the user to click Sync calendar. Completed Recall recordings also queue ElevenLabs transcription when Recall exposes a recording media URL. ElevenLabs webhooks update the local transcript job, store transcript text as a transcript segment, and mark the meeting ready when metadata contains `meetingId` and `transcriptJobId`.

Inngest events do not register functions by themselves. After deploying the app or changing `NEXT_PUBLIC_APP_URL`, run `npm run inngest:sync` to sync the public `/api/inngest` endpoint. If this sync is missing, upload rows can be created while transcript jobs stay queued with no ElevenLabs provider job id. Calendar event scheduling does not depend on Inngest; it is driven by Recall Calendar V2 reconciliation and webhooks.

## Verification

```bash
npm run lint
npm run test
npm run build
npx playwright test
```
