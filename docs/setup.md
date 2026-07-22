<p align="center">
  <img src="../public/brand/tape-lockup.svg" alt="Tape logo" width="270">
</p>

# Tape Setup

This guide covers the web application, provider callbacks, and the optional macOS local recorder.

## Requirements

1. Node.js 24
2. npm
3. A Postgres database and Neon Auth project
4. Cloudflare R2 object storage
5. Recall.ai, ElevenLabs, OpenRouter, and Inngest accounts for the complete meeting workflow
6. A public HTTPS origin for provider webhooks

The macOS recorder additionally requires macOS 15 or newer and Swift 6.

## Install

```bash
git clone https://github.com/glazec/tape.git
cd tape
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

Check the complete configuration before running a production deployment:

```bash
npm run setup:check
```

The check reports every missing or invalid value in one pass. Optional services
do not block deployment. OneSignal remains disabled unless both its app id and
REST API key are configured.

## Feature configuration

| Feature | Variables |
| --- | --- |
| Google Calendar OAuth | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` |
| Explicit Neon Auth base URL | `NEON_AUTH_BASE_URL` |
| Public R2 media URL | `R2_PUBLIC_BASE_URL` |
| Admin access | `APP_ADMIN_EMAILS` |
| Exa web search for live answers | `EXA_API_KEY` |
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

The R2 bucket must allow browser `PUT` requests from each application origin. Use only the production origin and the local origins that are actively needed:

```json
{
  "rules": [
    {
      "id": "tape-browser-uploads",
      "allowed": {
        "origins": [
          "https://your-app.example",
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

## Deploy the web application

[Vercel](https://vercel.com) is the supported web deployment target. Import the
repository into a new Vercel project, add the required variables from
`.env.example`, and set `NEXT_PUBLIC_APP_URL` to the final HTTPS origin.

For a CLI deployment:

```bash
npm run setup:check
npx vercel --prod
```

The production build validates the deployment environment, validates the
migration lineage, applies pending database migrations, and only then builds
the application. Preview deployments build without mutating the production
database.

After the first successful deployment:

1. Register the callback routes above using the deployed origin.
2. Add the deployed origin to the R2 browser upload CORS policy.
3. Configure the Google OAuth callback if calendar connection is enabled.
4. Run `npm run inngest:sync` with the production environment loaded.
5. Open `/settings/team` as the first administrator and set the team name,
   translation language, meeting bot identity, optional sharing group, and transcription vocabulary.
6. Verify `/api/health/dashboard` before inviting the team.

## Deploy the image worker

Screen share extraction runs as an optional service in the same Railway project as the Tape MCP. Name the Railway project `tape` and keep the MCP and image worker as separate services so each runtime retains its own build, variables, health checks, and scaling. The Vercel application emits an Inngest event after Recall recording completion. The worker downloads fresh Recall artifacts, runs ffmpeg and ffprobe, stores stable screen share frames in R2, and writes their metadata to Neon.

Configure these variables on the Railway service:

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

Build and check the worker locally:

```bash
npm run build:image-worker
PORT=3001 npm run start:image-worker
curl --fail http://127.0.0.1:3001/health
```

Railway uses `Dockerfile.image-worker` and `railway.json`. After assigning the service a public HTTPS origin, register its Inngest endpoint:

```bash
IMAGE_WORKER_URL=https://your-worker.example npm run inngest:sync:image-worker
```

Do not route the Next.js application to this service. The worker serves only `/api/inngest` and `/health`.

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

Run the portable verification gate before submitting or deploying a change:

```bash
npm run verify
```

On macOS, run the complete release gate:

```bash
npm run verify:all
```

See [testing architecture](testing.md) for the individual suites, coverage thresholds, and live calendar probe.

## Production checklist

1. Use production credentials and a production `NEXT_PUBLIC_APP_URL`.
2. Confirm the production build passed its migration lineage check and applied pending migrations.
3. Register every callback route with its provider.
4. Configure the R2 CORS origin.
5. Run `npm run inngest:sync` after deployment.
6. Restrict OneSignal allowed origins to the deployed application.
7. Confirm Recall.ai and ElevenLabs webhook signature verification with real test deliveries.
8. Keep `.env.local`, provider exports, meeting media, and logs outside Git.
9. If the image worker is enabled, verify its `/health` route and Inngest registration separately from the web application.
