# Meeting Note Setup

This guide covers the web application, provider callbacks, and the optional macOS local recorder.

## Requirements

1. Node.js 20.9 or newer
2. npm
3. A Postgres database and Neon Auth project
4. Cloudflare R2 object storage
5. Recall.ai, ElevenLabs, OpenRouter, and Inngest accounts for the complete meeting workflow
6. A public HTTPS origin for provider webhooks

The macOS recorder additionally requires macOS 15 or newer and Swift 6.

## Install

```bash
git clone https://github.com/glazec/meeting-note.git
cd meeting-note
npm install
cp .env.example .env.local
```

Never commit `.env.local`. Values in `.env.example` are public defaults or placeholders, not working credentials.

## Required configuration

Fill these values in `.env.local` for the complete application:

| Area | Variables |
| --- | --- |
| Database | `DATABASE_URL` |
| Neon Auth | `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, `NEON_AUTH_COOKIE_SECRET` |
| R2 storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Recall.ai | `RECALL_API_KEY`, `RECALL_API_BASE_URL`, `RECALL_WEBHOOK_SECRET` |
| ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| Application | `NEXT_PUBLIC_APP_URL` |

Generate the Neon Auth cookie secret locally:

```bash
openssl rand -base64 32
```

`RECALL_API_BASE_URL` must match the region of the Recall.ai API key. `RECALL_WEBHOOK_SECRET` must begin with `whsec_`. For local browser access, use `NEXT_PUBLIC_APP_URL=http://localhost:3000` until webhook testing requires a public origin.

## Feature configuration

| Feature | Variables |
| --- | --- |
| Google Calendar OAuth | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` |
| Explicit Neon Auth base URL | `NEON_AUTH_BASE_URL` |
| Public R2 media URL | `R2_PUBLIC_BASE_URL` |
| Admin access | `APP_ADMIN_EMAILS` |
| OneSignal reminders | `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS`, `ONESIGNAL_REST_API_KEY` |
| Twenty CRM vocabulary | `TWENTY_API_BASE_URL`, `TWENTY_API_KEY` |
| PostHog events | `POSTHOG_API_KEY`, `POSTHOG_HOST` |
| Cloudflare tunnel | `CLOUDFLARED_TOKEN` |

Leave optional variables empty when their feature is not used. `NEON_AUTH_BASE_URL` can remain empty when `NEON_AUTH_JWKS_URL` ends with `/.well-known/jwks.json`.

## Database

Apply every committed migration to the configured database:

```bash
npm run db:migrate
```

Run migrations before deploying code that depends on new tables, columns, indexes, or enum values.

## Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Google sign in must already be configured in Neon Auth.

## Public callbacks

Recall.ai, ElevenLabs, Google Calendar OAuth, and Inngest require a stable public HTTPS application origin. Configure these routes against `NEXT_PUBLIC_APP_URL`:

| Provider | Route |
| --- | --- |
| Recall.ai bot status | `/api/recall/webhook` |
| Recall.ai realtime events | `/api/recall/realtime/webhook` |
| Recall.ai Calendar V2 | `/api/recall/calendar/webhook` |
| ElevenLabs transcription | `/api/elevenlabs/webhook` |
| Google Calendar OAuth | `/api/calendar/oauth/callback` |
| Inngest | `/api/inngest` |

For the repository tunnel script, install `cloudflared`, set `CLOUDFLARED_TOKEN`, then run:

```bash
./scripts/dev-tunnel.sh
```

Update `NEXT_PUBLIC_APP_URL` to that HTTPS origin and restart the development server. Sync Inngest after the public route is reachable:

```bash
npm run inngest:sync
```

The R2 bucket must allow browser `PUT` requests from the application origin. The complete CORS example is in the root README.

## macOS local recorder

The recorder is a Swift package for macOS 15 or newer.

```bash
cd mac/LocalRecorder
swift test
./script/create_signing_cert.sh
./script/build_and_run.sh
```

The signing certificate step is needed once for stable microphone and screen recording permissions. Without it, the build script uses ad hoc signing and macOS may ask for permissions again after rebuilding. Configure the server URL and device login in the launched application.

## Verification

Run these checks before submitting or deploying a change:

```bash
npm run lint
npm run test
npm run build
npx playwright test
cd mac/LocalRecorder && swift test
```

The Playwright suite requires a configured local application and any provider state used by the selected tests.

## Production checklist

1. Use production credentials and a production `NEXT_PUBLIC_APP_URL`.
2. Apply database migrations.
3. Register every callback route with its provider.
4. Configure the R2 CORS origin.
5. Run `npm run inngest:sync` after deployment.
6. Restrict OneSignal allowed origins to the deployed application.
7. Confirm Recall.ai and ElevenLabs webhook signature verification with real test deliveries.
8. Keep `.env.local`, provider exports, meeting media, and logs outside Git.
