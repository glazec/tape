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
| Database | `DATABASE_URL`, `DATABASE_AUTHENTICATED_URL` |
| Neon Auth | `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, `NEON_AUTH_COOKIE_SECRET` |
| R2 storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Recall.ai | `RECALL_API_KEY`, `RECALL_API_BASE_URL`, `RECALL_WEBHOOK_SECRET`, `RECALL_REALTIME_WEBHOOK_URL` |
| ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` |
| Application | `NEXT_PUBLIC_APP_URL` |

Generate the Neon Auth cookie secret locally:

```bash
openssl rand -base64 32
```

`RECALL_API_BASE_URL` must match the region of the Recall.ai API key. `RECALL_WEBHOOK_SECRET` must begin with `whsec_`. `RECALL_REALTIME_WEBHOOK_URL` must be the durable HTTPS route that receives cloud bot events, such as `https://tape.example.com/api/recall/realtime/webhook`. Keep it pointed at the hosted application even when `NEXT_PUBLIC_APP_URL` uses localhost or a temporary development tunnel. This prevents local calendar syncs from replacing Zoom and Google Meet bot callbacks with an unavailable local route.

For local browser access, use `NEXT_PUBLIC_APP_URL=http://localhost:3000` until other webhook testing requires a public origin.

`DATABASE_URL` is the Neon owner connection used only by migrations and
privileged background jobs. `DATABASE_AUTHENTICATED_URL` must use a separate
login role without `BYPASSRLS`; all signed in web requests use that connection
and inject their verified Neon Auth claims in the same transaction as each
query. Never use the owner URL for `DATABASE_AUTHENTICATED_URL`.

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
| Tape MCP shared API keys | `APIKEY_DATABASE_URL` |
| Explicit Neon Auth base URL | `NEON_AUTH_BASE_URL` |
| Public R2 media URL | `R2_PUBLIC_BASE_URL` |
| Admin access | `APP_ADMIN_EMAILS`, `APP_SELF_HOSTED` |
| Exa web search for live answers | `EXA_API_KEY` |
| OneSignal reminders | `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS`, `ONESIGNAL_REST_API_KEY` |
| Twenty CRM vocabulary | `TWENTY_API_BASE_URL`, `TWENTY_API_KEY`; restricted to the team owning `iosg.vc` |
| PostHog events | `POSTHOG_API_KEY`, `POSTHOG_HOST` |
| SigNoz telemetry | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` |
| Cloudflare tunnel | `CLOUDFLARED_TOKEN` |

Leave optional variables empty when their feature is not used. `NEON_AUTH_BASE_URL` can remain empty when `NEON_AUTH_JWKS_URL` ends with `/.well-known/jwks.json`.

Hosted Tape defaults global administration to `yiping@iosg.vc`. A self hosted
installation can set `APP_SELF_HOSTED=true`; when `APP_ADMIN_EMAILS` is empty,
the first registered Tape user becomes the administrator. Set
`APP_ADMIN_EMAILS` to an explicit comma separated allowlist to override either
default.

## SigNoz telemetry

Tape uses OpenTelemetry to send Next.js request traces and Node.js logs to
SigNoz. Browser page views, navigation, safe action metadata, page load time,
uncaught errors, and unhandled promise rejections are batched through
`/api/telemetry/events`. The browser never receives the collector endpoint or
collector credentials.

Configure the common OTLP HTTP collector origin on the Vercel application:

```text
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otel-collector.example
OTEL_SERVICE_NAME=tape-web
```

Set the same endpoint on the Railway image worker with
`OTEL_SERVICE_NAME=tape-image-worker`. The SDK appends `/v1/traces` and
`/v1/logs`. Use the collector origin, not the SigNoz dashboard origin.
Self hosted SigNoz does not require an ingestion key by default. If the public
collector is protected by a reverse proxy, pass its encoded headers through
`OTEL_EXPORTER_OTLP_HEADERS`.

Telemetry intentionally excludes DOM text, form values, meeting content,
query strings, email addresses, and raw authenticated user IDs. Routes replace
UUID and long numeric path segments with `:id`.

## Database

Apply every committed migration to the configured database:

```bash
npm run db:migrate
```

Migration `0037_tenant_rls` creates the `tape_authenticated` and `tape_mcp`
group roles without login credentials. Create separate Neon login roles, assign
each group, and use their connection strings:

```sql
create role tape_web_login login password '<generated password>' nobypassrls;
grant tape_authenticated to tape_web_login;

create role tape_mcp_login login password '<generated password>' nobypassrls;
grant tape_mcp to tape_mcp_login;
```

Set `DATABASE_AUTHENTICATED_URL` to the `tape_web_login` connection. Set the
MCP server `DATABASE_URL` to the `tape_mcp_login` connection. Keep the Neon
owner connection only in the application `DATABASE_URL` used by migrations and
privileged background jobs. Rotate generated passwords through Neon rather
than placing literal credentials in migration files.

Run migrations before deploying code that depends on new tables, columns, indexes, or enum values.

## Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Google sign in must already be configured in Neon Auth. To accept public registrations, configure the Google provider to allow accounts outside the organization.

IOSG team members join the IOSG workspace with no Tape credit ceiling. Other domains already present in `allowed_domains` join their existing organization workspace and also have no Tape credit ceiling unless a limit is configured on their team. Unknown accounts receive isolated personal workspaces with $5 of provider credit. Do not rely on the first sign in to bootstrap an organization domain; insert the intended domain and team association explicitly before inviting organization members.

Server media uploads, transcript recovery, LocalRecorder provider uploads, and
administrator impersonation use persistent database rate limits. Provider
credit is checked before uploads are parsed and again immediately before
background transcription, translation, or bot scheduling starts. A five minute
background reconciliation removes scheduled bots for exhausted workspaces.

## Public callbacks

Recall.ai, ElevenLabs, Google Calendar OAuth, and Inngest require a stable public HTTPS application origin. Configure the Recall realtime route with `RECALL_REALTIME_WEBHOOK_URL`. Configure the remaining routes against `NEXT_PUBLIC_APP_URL`:

| Provider | Route |
| --- | --- |
| Recall.ai bot status | `/api/recall/webhook` |
| Recall.ai realtime events | `RECALL_REALTIME_WEBHOOK_URL` |
| Recall.ai Calendar V2 | `/api/recall/calendar/webhook` |
| ElevenLabs transcription | `/api/elevenlabs/webhook` |
| Google Calendar OAuth | `/api/calendar/oauth/callback` |
| Landing pricing calculator calendar | `/api/pricing-calendar/callback` |
| Inngest | `/api/inngest` |

Both Google routes use the same `GOOGLE_CALENDAR_CLIENT_ID`, so add **both** callback paths to the Authorized redirect URIs of that OAuth client. Without `/api/pricing-calendar/callback` registered, the landing page pricing calculator returns `?calendar=error` instead of an estimate.

The pricing calculator calendar flow is deliberately separate from the signed-in calendar connection: it is public, requests read-only event scope with `access_type=online` so Google issues no refresh token, creates no Tape session, writes nothing to the database, and holds the access token only in a short-lived encrypted `HttpOnly` cookie that is dropped once the estimate renders.

For the repository tunnel script, install `cloudflared`, set `CLOUDFLARED_TOKEN`, then run:

```bash
./scripts/dev-tunnel.sh
```

Update `NEXT_PUBLIC_APP_URL` to that HTTPS origin and restart the development server only when testing the other callbacks through the tunnel. Keep `RECALL_REALTIME_WEBHOOK_URL` on the durable hosted route when local and production use the same Recall.ai account. Sync Inngest after the public route is reachable:

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

## Deploy the media worker

Screen share extraction and long recording transcription run in a dedicated service in the same Railway project as the Tape MCP. Name the Railway project `tape` and keep the MCP and media worker as separate services so each runtime retains its own build, variables, health checks, and scaling. The Vercel application emits Inngest events after recording completion. The worker downloads the media, runs ffmpeg and ffprobe, and stores stable screen share frames in R2. Recordings over 60 minutes are converted into overlapping audio chunks no longer than 60 minutes. Every chunk is transcribed and checkpointed independently, then merged by timestamp before one canonical transcript and one translation job are published.

Configure these variables on the Railway service:

```text
DATABASE_URL
DATABASE_AUTHENTICATED_URL
ELEVENLABS_API_KEY
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
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_SERVICE_NAME=tape-image-worker
```

Build and check the worker locally:

```bash
npm run build:image-worker
PORT=3001 npm run start:image-worker
curl --fail http://127.0.0.1:3001/health
```

Railway uses `Dockerfile.image-worker` and `railway.json`. The historical file and service names remain `image-worker`, but the runtime is the Tape media worker. After assigning the service a public HTTPS origin, register its Inngest endpoint:

```bash
IMAGE_WORKER_URL=https://your-worker.example npm run inngest:sync:image-worker
```

Do not route the Next.js application to this service. The worker serves only `/api/inngest` and `/health`.

## Deploy Inngest on Railway

The production workflow engine runs as an always-on Railway service backed by
dedicated PostgreSQL and Redis services. The pinned runtime image and health
check live in `services/inngest-runtime`.

Configure the Inngest service with:

```text
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
INNGEST_POSTGRES_URI
INNGEST_REDIS_URI
```

Use private Railway URLs for PostgreSQL and Redis. Do not assign the engine a
public domain. Its dashboard and GraphQL API are enabled, so all public traffic
must pass through the gateway in `services/inngest-gateway`.

Deploy the gateway as a separate Railway service and configure:

```text
PORT=8080
INNGEST_UPSTREAM=http://inngest.railway.internal:8288
DASHBOARD_USERNAME
DASHBOARD_PASSWORD_HASH
SESSION_SECRET
MCP_AUTH_TOKEN_HASH
MCP_URL_TOKEN_HASH
```

Generate `DASHBOARD_PASSWORD_HASH` with `htpasswd -niB USERNAME`, then keep the
plaintext password in a password manager. Set `SESSION_SECRET` to at least 32
random bytes. Generate a separate MCP bearer token, store only its SHA 256
digest in `MCP_AUTH_TOKEN_HASH`, and keep the token in the MCP client's secret
configuration. For Claude custom connectors, generate a second independent
token and store only its SHA 256 digest in `MCP_URL_TOKEN_HASH`. Assign the
generated public Railway domain to the gateway on port `8080`. The gateway
leaves health, event, function registration, and signed SDK API routes available
while requiring a seven day secure cookie session for the dashboard and GraphQL
API.

Configure MCP clients with the exact bare endpoint and bearer header:

```text
URL=https://your-inngest-gateway.example/mcp
Authorization=Bearer YOUR_MCP_TOKEN
```

Do not use `/mcp/` with a trailing slash. The gateway consumes the bearer token
and does not forward it to the private Inngest engine.

Claude custom connectors do not provide an arbitrary header field. Configure
Claude with the separate URL token:

```text
URL=https://your-inngest-gateway.example/mcp?accessToken=YOUR_MCP_URL_TOKEN
```

Treat the complete URL as a secret. URL credentials can appear in client and
edge request logs. The gateway removes `accessToken` before proxying, disables
response caching, and keeps this credential separate so it can be rotated
without invalidating bearer clients. Never reuse the dashboard password,
Inngest signing key, or bearer token here.

The gateway returns `404` for OAuth discovery and dynamic registration routes.
This prevents Claude from mistaking the dashboard login page for an MCP OAuth
service after the URL token has already authenticated the MCP request.

Port `8289` is only needed if a future service uses Inngest Connect.

Set the same values on the Vercel application and image worker:

```text
INNGEST_BASE_URL=https://your-inngest-gateway.example
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
```

When `INNGEST_BASE_URL` is present, both Inngest sync scripts ask the deployed
application endpoints to register with that self-hosted engine. When it is
absent, they continue to use the Inngest Cloud sync API.

Active, queued, sleeping, and retrying runs are not transferred between
Inngest Cloud and the self-hosted database. Before cutover:

1. Pause new event producers where practical.
2. Let active Cloud runs finish or record the work that must be replayed.
3. Deploy the Railway engine and verify `/health`.
4. Update Vercel and the image worker with the new base URL and keys.
5. Redeploy both services.
6. Run `npm run inngest:sync` and `npm run inngest:sync:image-worker`.
7. Verify the registered functions and run one safe canary.
8. Disable the old Cloud applications so their cron functions cannot resume in a later billing period.
9. Run `npm run reminders:dispatch` with the production self hosted Inngest
   environment loaded to create delayed runs for every pending location reminder.

## macOS local recorder

The recorder is a Swift package for macOS 15 or newer.

```bash
cd mac/LocalRecorder
swift test
./script/create_signing_cert.sh
./script/build_and_run.sh --verify
```

The build script creates and opens `dist/Tape Desktop.app`. The signing certificate step is needed once for stable microphone and screen recording permissions. Without it, the build script uses ad hoc signing and macOS may ask for permissions again after rebuilding.

Tape Desktop initially connects to `https://tape.inevitable.tech`. Select `Sign in` to finish device login in the browser. For local development, expand `Advanced` and replace the server URL with the local Tape origin before signing in.

After device login, the recorder shows Microphone, Accessibility, Notifications, and Screen and System Audio as required setup items. Select `Enable` for each permission. Start at login is optional and uses a separate switch. Monitoring and recording begin after the four required permissions are granted.

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

1. Use production credentials, a production `NEXT_PUBLIC_APP_URL`, and a durable production `RECALL_REALTIME_WEBHOOK_URL`.
2. Confirm the production build passed its migration lineage check and applied pending migrations.
3. Register every callback route with its provider.
4. Configure the R2 CORS origin.
5. Run `npm run inngest:sync` after deployment.
6. Restrict OneSignal allowed origins to the deployed application.
7. Confirm Recall.ai and ElevenLabs webhook signature verification with real test deliveries.
8. Keep `.env.local`, provider exports, meeting media, and logs outside Git.
9. Verify the media worker `/health` route and Inngest registration separately from the web application. Confirm both `extract-meeting-video-frames` and `transcribe-meeting-in-chunks` are registered.
