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

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Neon, Google Calendar, R2, Recall, ElevenLabs, and Inngest credentials. `NEON_AUTH_BASE_URL` is optional when `NEON_AUTH_JWKS_URL` ends with `/.well-known/jwks.json`; generate `NEON_AUTH_COOKIE_SECRET` with `openssl rand -base64 32`.
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
2. `https://meeting-note-dev.inevitable.tech/api/elevenlabs/webhook`

## Auth

The app uses Neon Auth through the official Next.js SDK. Browser auth requests are proxied through `/api/auth/[...path]`, the landing page routes users to `/auth/sign-in`, and server code reads the current user from Neon Auth sessions instead of a hand rolled JWT cookie.
Dashboard, meeting transcript, and team settings pages require an authenticated session. Anonymous visitors are redirected to `/auth/sign-in`.

## Meeting Links

The new meeting page posts Google Meet and Zoom links to `/api/meetings/link`. The route requires an authenticated Neon Auth session, rejects unsupported meeting hosts, creates a local meeting row, and schedules a Recall bot with `/api/recall/webhook` as the callback URL. The Recall bot receives the local `meetingId` in metadata so later webhooks can update the same meeting.

Google sign in identifies the user through Neon Auth, so keep the Neon Auth Google redirect URI configured for sign in. Google Calendar permission is handled by the app owned OAuth flow at `/api/calendar/oauth/start` and `/api/calendar/oauth/callback`, because calendar scopes are separate from identity sign in. Add these app callback redirect URIs to the same Google OAuth client:

1. `https://meeting-note-swart.vercel.app/api/calendar/oauth/callback`
2. `https://meeting-note-dev.inevitable.tech/api/calendar/oauth/callback`
3. `http://localhost:3000/api/calendar/oauth/callback`

`/api/calendar/sync` retrieves a valid stored Google Calendar access token, refreshes it when needed, reads upcoming Google Calendar events, and emits `calendar/event.synced` to Inngest. The worker stores the `calendar_events` row, extracts supported Google Meet or Zoom URLs from `meetingUrl`, Google conference entry points, `hangoutLink`, `location`, or `description`, then creates a correlated `meetings` row and schedules Recall with `meetingId` plus `calendarEventId` metadata. Events without `location` are eligible when conferencing metadata contains the meeting link.

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

Shared transcript pages use `/share/[token]`. The route hashes the URL token, looks up an active `share_links` row, and returns 404 when the token is missing, expired, or revoked.

## Exports

Meeting transcript pages can export transcript text, export MP3 audio through the authenticated audio route, export both files, or copy transcript text to the clipboard.

## Vendor Webhooks

Recall bot status webhooks are delivered to endpoints configured in the Recall dashboard. ElevenLabs speech to text webhooks are delivered to workspace configured webhooks when transcript jobs set `webhook=true`. Both webhook routes verify vendor signatures from the raw request body before parsing the event, store an idempotency record, and only apply side effects for newly inserted webhook events.

Recall webhooks update the local meeting status when metadata contains a `meetingId`. Completed Recall recordings also queue ElevenLabs transcription when Recall exposes a recording media URL. ElevenLabs webhooks update the local transcript job, store transcript text as a transcript segment, and mark the meeting ready when metadata contains `meetingId` and `transcriptJobId`.

Inngest events do not register functions by themselves. After deploying the app or changing `NEXT_PUBLIC_APP_URL`, run `npm run inngest:sync` to sync the public `/api/inngest` endpoint. If this sync is missing, upload rows can be created while transcript jobs stay queued with no ElevenLabs provider job id.

## Verification

```bash
npm run lint
npm run test
npm run build
npx playwright test
```
