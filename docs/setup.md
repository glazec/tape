<p align="center">
  <img src="../public/brand/tape-lockup.svg" alt="Tape logo" width="270">
</p>

# Tape Setup

This guide covers the web application, provider callbacks, and the optional macOS local recorder.

Manual calendar sync dispatches `calendar/history.repair` to Inngest after recent event sync. Register the `repair-calendar-history` function when deploying. The worker uses the stored Google refresh token to read current details for Google Calendar events, including events never imported, without meeting records in the past 30 days. It runs one job per connection at a time and persists one retryable step per event. Tokens remain inside each step and are not included in event payloads or step results. Missing Google credentials require reconnecting the calendar.

Calendar import accepts timed invitations with at least two distinct participant emails even without a link or location. These use local recording reminders; historical repair creates missed records without scheduling capture.

Replace audio uses the existing audio upload, storage, and transcription configuration; no additional provider configuration is required.

Note moment anchors use the existing private note blocks column; no additional migration or provider is required beyond the note migrations below. Recording import preview and bounded MP4 creation metadata inspection run in the browser. Calendar choices use already synced meeting records in the selected workspace. Date inference does not require an AI provider. Deploy the updated browser and upload routes together; both direct and fallback completion accept optional `meetingId` and `title`, recheck empty calendar target eligibility, and return the destination meeting URL.

Personal meeting notes require migration `0051_meeting_notes` before deploying the web service. Apply pending migrations using `npm run db:migrate`. No new provider or environment variable is needed. The notes table enforces both the current user identity and meeting read access through row level security. Notes are excluded from transcript exports, completion emails, and MCP access.

Automatic note answers additionally require migration `0058_meeting_note_blocks` and the existing `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. No new provider is required. Generation uses the current meeting transcript, the existing meeting credit checks and assistant usage accounting, with a limit of 12 answer requests per user per minute. Questions wait when no transcript has been persisted yet. Contexts larger than 180,000 serialized characters show an explicit size limit rather than silently truncating evidence.

Set `NEXT_PUBLIC_APP_URL` to the public web origin so desktop login never hands off an internal reverse proxy address. Keep `NEON_AUTH_COOKIE_SECRET` stable across releases. Dashboard failures no longer clear cookies. The auth proxy handles meeting URLs and preserves their callback destination. Desktop login logs `recorder.login.started`, `recorder.login.sign_in_required`, `recorder.login.rejected`, and `recorder.login.handoff_ready` without tokens or callback URLs. Device version, permissions, and last activity are stored in `local_recorder_devices` after authenticated status checks, including incomplete permission setup. These records do not prove that a downloaded app launched before sign in.

Web authentication is managed by Better Auth inside Tape. Migration `0063_web_auth_sessions` creates private `web_auth_*` tables and imports existing user IDs and Google account associations without copying provider tokens. Set `WEB_AUTH_GOOGLE_CLIENT_ID` and `WEB_AUTH_GOOGLE_CLIENT_SECRET` to the existing Google client and add `https://<app-origin>/api/auth/callback/google` to its allowed redirects before deployment. Keep the old Neon callback during migration.

Sessions expire 180 days after login. Automatic expiry extension and browser session caching are disabled. Keep `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, and `NEON_AUTH_COOKIE_SECRET` stable across deployments; never generate the secret at startup. The app checks the database for each authenticated session, and sign out deletes that session. Provider authorization and calendar tokens have separate lifetimes.

Existing browsers with a valid Neon session pass through `/api/auth/migrate-session`. The server verifies the old session directly with Neon, preserves its imported identity, revokes the old session, and issues the new cookie. Cached browser identity alone is insufficient. Retain the Neon endpoint during this transition; invalid or expired old sessions require Google sign in. Desktop recorder identity and MCP authentication retain their existing mechanisms. A rollback to the old application may require signing in again because migrated old sessions have been revoked.

## Requirements

1. Node.js 24
2. npm
3. A Postgres database and Google OAuth web client
4. Cloudflare R2 object storage
5. Recall.ai, ElevenLabs, and OpenRouter accounts, plus a self hosted Inngest engine or Inngest Cloud account for background work
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
| Web authentication | `WEB_AUTH_GOOGLE_CLIENT_ID`, `WEB_AUTH_GOOGLE_CLIENT_SECRET`, `NEON_AUTH_COOKIE_SECRET` |
| R2 storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Recall.ai | `RECALL_API_KEY`, `RECALL_API_BASE_URL`, `RECALL_WEBHOOK_SECRET`, `RECALL_REALTIME_WEBHOOK_URL` |
| ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`; `INNGEST_BASE_URL` for a self hosted engine |
| Application | `NEXT_PUBLIC_APP_URL`, `MCP_BACKEND_SHARED_SECRET` |

`OPENROUTER_MODEL` must support the realtime chat/completions endpoint; deployment validation rejects `:batch` models. GLM 5.3 models use low reasoning because the provider requires reasoning to remain enabled.

Transcript translation and original language polishing use `google/gemini-3.8-flash` through OpenRouter. Polishing actively rewrites awkward speech into concise sentences while preserving substantive details, uncertainty, corrections, language, and segment boundaries. It requests strict structured output and accepts short edits instead of requiring short lines to remain verbatim. Unusable output falls back to the original segment. Existing saved polish is skipped by enrichment; deploying a prompt change does not regenerate past meetings. `OPENROUTER_MODEL` selects the assistant and meeting notes model independently.

AI followup also uses `google/gemini-3.8-flash`, with low reasoning because this endpoint does not accept disabled reasoning. Prompt version 6 includes the evaluated examples for relationships, offers versus commitments, Chinese corrections, and complete research quotations. Research selects evidence before writing context; saved version 5 followups remain readable until regenerated. Followup generation currently uses chat completions, not the provider Batch API. Apply migration `0057_meeting_followup` before deploying the updated web application. Followups are generated automatically on transcript completion and on demand through `POST /api/meetings/:meetingId/followup`, stored in the meeting row under existing access policies, and shown only while the current transcript fingerprint matches. The route requires meeting management access and provider credit, rechecks source and access before saving, and validates explicit speaker names and exact evidence. Input above 400,000 serialized characters is rejected rather than truncated. Potential research and Potential connections are stored in the existing JSON followup result and require no new database migration. Connections cover people, teams and project relationships; they use cited segment IDs for speaker attribution and a separate connectionsSourceHash that excludes speaker labels. Renames preserve connections, while content or access-filtered composition changes invalidate them. Generation validates referenced segments and cited speaker anchors, and requires a connections array from the provider. Connection evidence stores segment IDs only; source popovers display original transcript text directly. Existing summaries remain visible until regenerated. Research prompts are copied locally by the reader and contain the question, meeting context, source excerpts and suggested evidence to collect. Clipboard copying requires a secure browser context and permission; failures show an error toast. No automatic backfill or external research execution is added by this feature.

Connection corrections use PATCH /api/meetings/:meetingId/connections with the current connections revision, entry index and validated changes. This manager-only endpoint checks readiness, visible attribution segments, the source fingerprint and optimistic concurrency against the stored JSON and meeting timestamp. Corrections live in aiFollowup.connectionEdits alongside original model entries, requiring no migration. Regeneration preserves edits for the same connection source fingerprint and uses a JSON comparison to avoid overwriting concurrent edits. Ambiguous regenerated matches retain the corrected entry. Organization ordering uses current workspace domains and unambiguous participant emails. AI and legacy model mutual markers are cleared before applying manual corrections. Mutual confirmation needs no model call. GET on the same manager-only endpoint returns the latest entries, stable original-entry identifiers and revision, allowing conflict recovery without losing the draft.

For a new installation, generate the Web session signing secret locally and store it as `NEON_AUTH_COOKIE_SECRET`. Existing deployments must retain their current value:

```bash
openssl rand -base64 32
```

Generate a separate MCP backend secret with the same command. Set that value as `MCP_BACKEND_SHARED_SECRET` on both `tape-web` and the Tape MCP service. It signs short lived identity bound upload requests and must not reuse the OAuth JWT signing key.

MCP Google OAuth refresh sessions have no local calendar expiry. Keep `FASTMCP_JWT_SIGNING_KEY` stable and `OAUTH_STORAGE_PATH` on the service's persistent volume. Access tokens remain short lived; Google revocation or upstream authorization expiry still requires login. Existing valid MCP sessions adopt this behavior on their next refresh. Already expired sessions require reconnecting once. This does not change Calendar authorization or browser sessions.

`RECALL_API_BASE_URL` must match the region of the Recall.ai API key. `RECALL_WEBHOOK_SECRET` must begin with `whsec_`. `RECALL_REALTIME_WEBHOOK_URL` must be the durable HTTPS route that receives cloud bot events, such as `https://tape.example.com/api/recall/realtime/webhook`. Keep it pointed at the hosted application even when `NEXT_PUBLIC_APP_URL` uses localhost or a temporary development tunnel. This prevents local calendar syncs from replacing Zoom and Google Meet bot callbacks with an unavailable local route.

For local browser access, use `NEXT_PUBLIC_APP_URL=http://localhost:3000` until other webhook testing requires a public origin.

`DATABASE_URL` is the Neon owner connection used by migrations, private Web authentication tables, and
privileged background jobs. `DATABASE_AUTHENTICATED_URL` must use a separate
login role without `BYPASSRLS`; signed in product data requests use that connection
and inject their verified session identity in the same transaction as each
query. Never use the owner URL for `DATABASE_AUTHENTICATED_URL`.

Check the complete configuration before running a production deployment:

```bash
npm run setup:check
```

The check reports every missing or invalid value in one pass. Optional services can remain unset. Partially configured or invalid optional
settings can still fail the check: OneSignal requires both its app id and REST
API key, and `SENTRY_AUTH_TOKEN` requires `NEXT_PUBLIC_SENTRY_DSN`. The check
validates configuration values; it does not test provider credentials or database connectivity.

## Feature configuration

| Feature | Variables |
| --- | --- |
| Google Calendar OAuth | `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` |
| Tape MCP shared API keys | `APIKEY_DATABASE_URL` |
| Legacy browser migration | `NEON_AUTH_BASE_URL` or `NEON_AUTH_JWKS_URL` |
| MCP legacy JWT validation | `NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER` |
| Public R2 media URL | `R2_PUBLIC_BASE_URL` |
| Admin access | `APP_ADMIN_EMAILS`, `APP_SELF_HOSTED` |
| Exa web search and Intel link extraction | `EXA_API_KEY` |
| Intel X post fallback | `TWITTERAPI_IO_API_KEY` |
| Automatic notes and transcript email | `RESEND_API_KEY`, optional `MEETING_EMAIL_FROM` |
| OneSignal reminders | `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGINS`, `ONESIGNAL_REST_API_KEY` |
| Twenty CRM vocabulary | `TWENTY_API_BASE_URL`, `TWENTY_API_KEY`; restricted to the team owning `iosg.vc` |
| Amplitude browser analytics | No environment variable; the public project key is initialized in `instrumentation-client.ts` |
| SigNoz telemetry | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` |
| Sentry errors, traces, and logs | `NEXT_PUBLIC_SENTRY_DSN`; optional source maps via `SENTRY_AUTH_TOKEN` |
| Cloudflare tunnel | `CLOUDFLARED_TOKEN` |

Amplitude records sessions, campaign attribution, web vitals, main thread
blocks, safe interaction and frustration signals for heatmaps, and the app's
semantic product events. Session Replay samples all sessions while usage is
low. Its conservative privacy mode masks all text, form values, accessible
labels, and titles. It blocks images, audio, video, canvases, iframes, and
elements marked with `data-amplitude-block`.

Leave optional variables empty when their feature is not used. `NEON_AUTH_BASE_URL` can remain empty when `NEON_AUTH_JWKS_URL` ends with `/.well-known/jwks.json`.

Hosted Tape defaults global administration to `yiping@iosg.vc`. A self hosted
installation can set `APP_SELF_HOSTED=true`; when `APP_ADMIN_EMAILS` is empty,
the first registered Tape user becomes the administrator. Set
`APP_ADMIN_EMAILS` to an explicit comma separated allowlist to override either
default.

## Meeting email

Email delivery is disabled while `RESEND_API_KEY` is empty. On `tape-web`, set a Resend sending key and optionally `MEETING_EMAIL_FROM`; the default sender is `Tape <tape@inevitable.tech>`. Verify `inevitable.tech` in Resend and install its required DNS records before using that address. Another verified sender can be used by changing `MEETING_EMAIL_FROM`. Never put the key in a public environment variable or commit it.

Apply migration `0056_meeting_completion_email` with `npm run db:migrate`, deploy the web service, and run `npm run inngest:sync` so `send-meeting-email` and `reconcile-meeting-emails` are registered. Deploy the image worker too: its chunked transcription completion event now enables email. Inngest consumes the existing completion enrichment event independently of polishing and translation. No additional workflow service is needed.

New recording completion events enable delivery by default for every meeting owner. Existing meetings are not backfilled, manual translation does not trigger mail, and pasted transcripts do not trigger recording completion. Email uses the owner's stored login address, never calendar attendee addresses or a client supplied recipient. Each recording generation sends once; replacing audio creates a new generation. All active audio parts must complete before sending. A failed part suppresses partial delivery. The job waits up to three hours if completion is still pending.

The email contains two UTF8 TXT attachments: AI generated notes and the complete original transcript with speakers and timestamps. Notes use the existing OpenRouter model and credit checks. Long transcripts are divided without truncation and summarized in persisted steps; part notes are concatenated in recording order. Summary usage is recorded under the existing assistant category.

The first prepared email body, recipient, sender, attachments, and audio job IDs are frozen in `transcript_jobs.completion_email_payload`. Retry uses those exact bytes and `meeting-email/<anchor job ID>` as the Resend idempotency key. Successful API acceptance persists `completion_email_id` and `completion_email_sent_at`, then clears the duplicate private attachment payload. The receipt prevents later duplicate sends. Resend acceptance does not prove inbox delivery.

Transcript completion writes `completion_email_ready_at` in the same database transaction as the transcript. Every five minutes, `reconcile-meeting-emails` checks up to 50 pending current replacement generations whose audio parts have all completed and dispatches email independently of enrichment. Dispatched rows move behind other pending meetings so repeated failures do not starve the queue. This recovers lost completion events and failed deliveries. Meetings completed before this migration have no ready timestamp and are excluded. Completions recorded while email is disabled can be delivered after email is configured.

Resend retains idempotency keys for 24 hours. Automatic retries stop after 23 hours from preparation and require checking provider logs before manual replay. The reconciliation scan also excludes expired prepared requests. Changed audio job membership or a changed owner address suppresses a frozen payload. Delivery failures appear in the separate Inngest function without failing transcription or translation.

To verify live delivery, complete a new short recording, inspect both received TXT files, confirm that only the owner received it, and replay the completion event to confirm no second email. Confirm a provider delivery event or actual inbox receipt in addition to stored API acceptance. Local mocks do not establish domain verification, deployment, or delivery.

## SigNoz telemetry

Tape uses OpenTelemetry to send Next.js request traces and Node.js logs to
SigNoz. Browser page views, navigation, safe action metadata, page load time,
uncaught errors, and unhandled promise rejections are batched through
`/api/telemetry/events`. The browser never receives the collector endpoint or
collector credentials.

Configure the common OTLP HTTP collector origin on the Railway web service:

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

Error logs include `error.fingerprint`, `error.handled`, `error.type`,
`operation.name`, and `telemetry.source`. Final Inngest failures also include
`inngest.function.id`, `inngest.run.id`, and `inngest.attempt`, so retries and
terminal failures can be separated without parsing log messages.

## Sentry monitoring

Tape sends uncaught browser, server, edge, React render, and Next.js request
errors to the `tape` project in the `iosg` Sentry organization. Handled server
ERROR logs and final background job failures also create Sentry issues, while
retaining the sanitized structured logs. Console capture works with Sentry alone;
it does not require an OTLP collector. Next.js request errors are not captured
a second time by the log bridge. Set `NEXT_PUBLIC_SENTRY_DSN` on both the Railway
web service and image worker. The worker initializes its own Sentry client. For readable production
stack traces, also set `SENTRY_AUTH_TOKEN` with the `org:ci` scope so the build
can upload source maps. Never expose that token to the browser or commit it.

Configured SDKs capture every error. Production browser and edge traces are
sampled at ten percent; the web server captures every trace. The image worker
keeps its existing OTLP tracing provider and sends errors and logs to Sentry.
Development browser and edge tracing captures every trace when a DSN is configured.
Browser session replay records ten percent of production sessions, every
development session, and every session that hits an error. Replays show
on-screen text, including meeting titles, transcripts, and notes, so UI bugs
can be reviewed. Typed input values stay masked, audio and video are blocked,
and no network request or response details are recorded. Add
`data-sentry-mask` to hide an element's text or `data-sentry-block` to hide it
entirely. Console frames are dropped, and replay URLs lose identifiers and
query strings.
The SDK excludes user identity, cookies, headers, request and response bodies,
query parameters, database values, GraphQL documents and variables, AI inputs
and outputs, stack variables, console breadcrumbs, and UI interaction
breadcrumbs. Client source maps are removed after upload.

Desktop builds use the native Sentry SDK for crashes and handled recording,
audio metering, capture stream, file write, SDK termination, and upload failures.
Set `SENTRY_DSN` when packaging the app; `NEXT_PUBLIC_SENTRY_DSN` is also accepted.
Release builds reject a missing DSN. Each handled error report attaches a PNG of
Tape's own visible windows, which can show meeting titles; other apps and the
desktop are never captured, and no screen recording permission is used. Crash
reports have no screenshot. The release workflow reads the public DSN
from the repository Actions variable `SENTRY_DSN` and sets the environment to
`production`. Local packages default to `development`; verification uses
`coverage-verification`. Reports include operation, error type, code, and app
version, without raw error descriptions, meeting content, tokens, or user identity.
Native startup runs on the main actor before the recorder model starts.

## Database

Apply every committed migration to the configured database. For local setup, explicitly load `.env.local`; `npm run db:migrate` reads the process environment and does not load that file:

```bash
node --env-file=.env.local node_modules/drizzle-kit/bin.cjs migrate --config=drizzle.config.ts
```

On Railway or in a shell where `DATABASE_URL` is already set, use `npm run db:migrate`. Other migration commands in this guide assume that environment is loaded. A fresh database needs only the owner `DATABASE_URL` for this step; create the restricted login below afterward and set `DATABASE_AUTHENTICATED_URL` before starting the app.

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

Open [http://localhost:3000](http://localhost:3000). Register `/api/auth/callback/google` on the Google OAuth web client for the exact application origin. To accept public registrations, configure the Google provider to allow accounts outside the organization.

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
| Web Google sign in | `/api/auth/callback/google` |
| Google Calendar OAuth | `/api/calendar/oauth/callback` |
| Landing pricing calculator calendar | `/api/pricing-calendar/callback` |
| Inngest | `/api/inngest` |

Keep only the current Tape transcription webhook enabled in the ElevenLabs workspace. Legacy deployments sharing the database can claim the same callback before the current deployment and bypass newer completion behavior.

Both calendar routes use the same `GOOGLE_CALENDAR_CLIENT_ID`, so add **both** callback paths to the Authorized redirect URIs of that OAuth client. Without `/api/pricing-calendar/callback` registered, the landing page pricing calculator returns `?calendar=error` instead of an estimate.

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

[Railway](https://railway.com) is the supported web deployment target. Create a
`tape-web` service in the `tape` project, connect the `glazec/tape` repository
and `main` branch, and set the Railway config path to `/railway.web.json`. Add
the required variables from `.env.example` and set `NEXT_PUBLIC_APP_URL` to the
final HTTPS origin. The root `/railway.json` remains assigned to the media
worker.

The Tape MCP service must use the same `MCP_BACKEND_SHARED_SECRET` as `tape-web` and set `APP_BASE_URL` to the production web origin. Its database login remains the RLS enforced, read only `tape_mcp` role because meeting creation runs only through the signed web routes.

For a CLI deployment:

```bash
npm run setup:check
railway up --service tape-web
```

The Railway build validates the deployment environment and migration lineage,
then builds the application. A pre-deploy container applies pending database
migrations. Railway checks `/api/health/dashboard` before routing production
traffic to the new deployment.

After the first successful deployment:

1. Register the callback routes above using the deployed origin.
2. Add the deployed origin to the R2 browser upload CORS policy.
3. Configure the Google OAuth callback if calendar connection is enabled.
4. Run `npm run inngest:sync` with the production environment loaded.
5. Open `/settings/team` as the first administrator and set the team name,
   translation language, meeting bot identity, optional sharing group, and transcription vocabulary.
6. Verify `/api/health/dashboard` before inviting the team.
7. Attach the production domain, publish Railway's CNAME and TXT verification
   records as DNS only, and wait for the certificate to become valid.

## Deploy the media worker

Screen share extraction and long recording transcription run in a dedicated service in the same Railway project as the Tape MCP. Name the Railway project `tape` and keep the web application, MCP, and media worker as separate services so each runtime retains its own build, variables, health checks, and scaling. The web application emits Inngest events after recording completion. The worker downloads the media, runs ffmpeg and ffprobe, and stores stable screen share frames in R2. Recordings over 60 minutes are converted into overlapping audio chunks no longer than 60 minutes. Every chunk is transcribed and checkpointed independently, then merged by timestamp before one canonical transcript and one translation job are published.

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
INNGEST_BASE_URL=https://your-inngest-gateway.example
NEXT_PUBLIC_SENTRY_DSN
OTEL_EXPORTER_OTLP_ENDPOINT
OTEL_SERVICE_NAME=tape-image-worker
```

Use the same Inngest keys and gateway URL as the web service. Sentry and OTLP settings are optional; set them to enable worker monitoring.

Build and start the worker locally with `.env.local` loaded:

```bash
npm run build:image-worker
PORT=3001 node --env-file=.env.local dist/image-worker/server.mjs
```

Leave that process running and check it from another terminal:

```bash
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

Set the same values on the Railway web service and image worker:

```text
INNGEST_BASE_URL=https://your-inngest-gateway.example
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
```

The web sync command refuses to register a localhost app URL with a remote engine. Run production sync with the deployed service environment; local development must use a local engine or an explicitly configured public endpoint.

When `INNGEST_BASE_URL` is present, both Inngest sync scripts ask the deployed
application endpoints to register with that self-hosted engine. When it is
absent, they continue to use the Inngest Cloud sync API.

Active, queued, sleeping, and retrying runs are not transferred between
Inngest Cloud and the self-hosted database. Before cutover:

1. Pause new event producers where practical.
2. Let active Cloud runs finish or record the work that must be replayed.
3. Deploy the Railway engine and verify `/health`.
4. Update the Railway web service and image worker with the new base URL and keys.
5. Redeploy both services.
6. Run `npm run inngest:sync` and `npm run inngest:sync:image-worker`.
7. Verify the registered functions and run one safe canary.
8. Disable the old Cloud applications so their cron functions cannot resume in a later billing period.
9. Run `npm run reminders:dispatch` with the production self hosted Inngest
   environment loaded to create delayed runs for every pending location reminder.

## macOS local recorder

The recorder is a Swift package for macOS 15 or newer.

Automatic monitoring and missed bot alerts select personally owned meetings or meetings with active participant access and management rights, matching the destination picker. Workspace admin access alone does not qualify unrelated events. Pending missed bot notifications recheck this scope before delivery, so previously queued unrelated alerts are discarded at their next delivery check. This filtering is implemented on the server; changing it requires a server deployment, without a desktop rebuild or database migration.

The recording destination workflow requires migration `0065_recording_timeline_offsets` before deploying the updated server. It adds the nullable applied transcript offset used to preserve capture order when resumed audio arrives out of order. Deploy the matching server before distributing the desktop update. An HTML 404 from these routes means the server release is missing; the app reports that recording needs a server update instead of offering another meeting. A JSON 404 from the recording API still represents a missing meeting. The authenticated desktop routes are `GET /api/local-recorder/recording-meetings`, `POST /api/local-recorder/recording-target`, and the target's `finish` and `status` routes. Existing meeting selection is limited to the paired workspace and the caller's meeting management rights. Stop and destination changes share a device lock, with a fresh database snapshot after acquiring it, so Stop freezes one confirmed destination even if a change is in flight. Starting a capture checks provider credit; moving an active capture within its workspace does not start new provider work.

```bash
cd mac/LocalRecorder
swift test
./script/build_and_run.sh --verify
```

Release builds create and open `dist/Tape Desktop.app` using the existing release certificate. It refuses a different signing identity for the production bundle identifier, including an ad hoc signature or a newly created certificate with the same name. Import the existing release identity to build runnable packages; `swift test` and debug snapshots do not need it. Do not use `create_signing_cert.sh` for this app identity.

The default debug build creates and opens `dist/Tape Desktop Dev.app` with a separate `.dev` bundle identifier, executable, login callback scheme, Keychain entry, preferences, and recording directory. Release builds create `dist/Tape Desktop.app`. Development builds do not start Sparkle updates or replace the release app. The server must include support for the `meetingnote-local-recorder-dev://login` callback before browser pairing a development build. Run `script/create_signing_cert.sh` once for the separate development identity. Development packaging requires a stable signing identity and does not reset permissions.


Tape Desktop initially connects to `https://tape.inevitable.tech`. Select `Sign in` to finish device login in the browser. In debug builds, open settings and expand `Development server` before signing in to use a local Tape origin. Release builds use browser pairing without editable server or token fields.

The recorder settings show Microphone, Accessibility, Alerts, and Screen and System Audio as required setup items. Select `Allow` for each permission; these settings also work before sign in. Open at login is optional and uses a separate switch. Monitoring and recording require sign in and the four required permissions.

If a setup permission appears enabled in System Settings but the app still reports it missing, expand `Already enabled in Settings?` during setup or `Access still blocked?` in recorder settings. Quit other copies and try `Restart to check access` first; restarting does not reset grants. If access remains blocked, choose only the affected permission's `Repair` action. After confirmation, the app refreshes the current bundle's Launch Services registration and restarts that exact copy. Microphone, Accessibility, and Screen and system audio repair reset the selected authorization for the bundle identifier before requesting it in a fresh process. This does not guarantee that macOS removes the visible Settings row. If an old entry remains enabled but access is blocked, remove it where Settings supports removal and add the current app revealed by `Show this app in Finder`. Notifications preserve the existing authorization and reopen Settings if denied. Restart failures keep the app open with recovery instructions. Local builds and launches never reset permissions automatically. Keep the published release certificate unchanged. Automated probes do not prove that stale grants are repaired on the affected Mac.

Desktop device sessions last 180 days from login. Migration `0064_desktop_session_lifetime` extends currently valid, unrevoked sessions to 180 days from their original creation time, retaining the same credential and device binding. It does not reactivate expired or revoked sessions or shorten longer sessions. Credentials remain in the macOS Keychain and session hashes remain in Postgres, so backend deployments do not reset login. This server change requires no new desktop binary.

Audio checks appear after capture permissions are ready. Settings show the signed in email and the workspace paired with this Mac. Changing the browser workspace does not move the device session; sign out and pair again to select another workspace. Restart waits for a replacement app instance before quitting; if opening fails, the current app stays open and reports the failure.

Keep the recorder open while a stopped SDK capture is uploading. Capture stop and upload completion are separate states: the desktop polls its scoped recording status before shutting down that capture's SDK process. Local audio is saved to a durable upload queue before network work. Recovery metadata preserves unconfirmed starts and stopped captures across app restarts. Do not infer upload success from a stopped timer; confirm the meeting contains its media and transcript after processing.

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
2. Confirm the production build passed its migration lineage check and the pre-deploy migration command completed successfully.
3. Register every callback route with its provider.
4. Configure the R2 CORS origin.
5. Run `npm run inngest:sync` after deployment.
6. Restrict OneSignal allowed origins to the deployed application.
7. Confirm Recall.ai and ElevenLabs webhook signature verification with real test deliveries.
8. Keep `.env.local`, provider exports, meeting media, and logs outside Git.
9. Verify the media worker `/health` route and Inngest registration separately from the web application. Confirm both `extract-meeting-video-frames` and `transcribe-meeting-in-chunks` are registered.

Calendar accounts use Google’s verified email from the UserInfo endpoint. Apply migrations `0052_multiple_calendar_accounts` and `0053_organization_bot_profiles` before deploying this feature. Existing unnamed connections remain intact and can be disconnected individually. Reconnecting identifies the account without overwriting an unnamed connection. To treat organization domains as one company, associate their `allowed_domains` rows with the same `team_id`; set the preferred organization bot in Team settings. Do not merge existing workspaces or move their meeting data implicitly. Migration `0054_iosg_iosf_company` associates `iosg.vc` and `iosf.vc` with the existing IOSG workspace, preserves the IOSG bot profile, creates an independently editable IOSF bot profile, and prefers the IOSF bot when its domain is invited. It skips installations without an IOSG workspace and refuses to merge an existing separate IOSF workspace. Migration `0055_consolidate_legacy_iosf_calendar` also moves the existing standalone IOSF calendar, its events, and its meetings into this company workspace, retaining record IDs and granting its former owner company administration. It refuses consolidation if another organization, extra workspace configuration, active bots, or conflicting online meeting keys are present. A duplicate historical missed in person record retains its ID and calendar reference, with its derived grouping key cleared. Existing company admin roles and both bot profiles are preserved.

## Organization workflow migration

Apply migration `0059_meeting_bot_organization` before deploying the organization workflow changes. It adds the nullable `meetings.bot_organization_domain` column used to preserve an explicitly selected bot on retry and resume. Existing calendar records with no override retain attendee and account based bot selection. No new environment variables are required. Local checks do not establish a successful production migration or a live bot join.

## Meeting continuity migration

Apply `0060_meeting_continuity` before deploying the continuity routes. It adds `meetings.bot_display_name`, the access controlled `meeting_parts` relation, merge validation, and the atomic continuation claim function. No new environment variables are required. The one hour window uses `recordings.ended_at`. A definite provider refusal can be retried; an uncertain network outcome keeps its claim so a second bot is not dispatched. Signed provider callbacks can confirm that claim.

This is the cloud bot continuation flow. Existing native recorder uploads and replacement audio processing keep their original source records. Production verification still requires migration success, deployment, and authenticated capture through the provider. Local fixtures do not establish a successful live join.

## Recall notification recovery

Configure the Recall dashboard endpoint against the current production `NEXT_PUBLIC_APP_URL` at `/api/recall/webhook`. Do not leave it on an obsolete hosting provider domain. This endpoint accepts both bot/recording events and signed Calendar V2 events; the dedicated calendar route remains supported. After changing the endpoint, verify a real delivery returns 200 and reaches `vendor_webhook_events`.

Register `reconcile-recall-meetings` with Inngest after deployment. It runs every five minutes and accepts `meeting/reconcile.recall` for an immediate recovery pass. It checks up to 100 oldest-updated unresolved bot meetings from the past 30 days, verifies recording readiness, and reuses the recording and transcription job. Inngest event IDs deduplicate interrupted queued dispatches. Per-meeting durable steps isolate failures; failed steps retry and surface a failed run rather than silently reporting success.

A provider 404 is treated as an unavailable bot and marks the unresolved meeting failed, preserving its provider identity and any running or completed transcript work. Permanent missing bots do not hold up subsequent recovery steps.

## Intel search setup

Apply migration `0066_intel_search.sql` before deploying this code. It adds `meetings.ai_intel` and private `intel_searches` with caller scoped row level security. Apply migration `0067_intel_background.sql` for saved search jobs. Register `run-intel-search` to process `intel/search.requested` events. Deploy and register `generate-meeting-intel` and `reconcile-meeting-intel` with Inngest. Extraction listens to `meeting/enrich.transcript` and `meeting/intel.generate`; the repair job queues up to 50 meetings at minute 17 each hour. Attempts persist a checked time; failed or oversized records wait six hours before another scheduled attempt, and unattempted records are processed first. Extraction concurrency is three overall and one per meeting.

Intel uses `OPENROUTER_API_KEY` with `typesafe/jev-router` only for background extraction. `typesafe/jev-1.14` independently verifies extracted intel at a support threshold of 0.90. Search calls `typesafe/jev-1.14` directly through the Decisions API: Score returns a weighted position on five ordered relevance levels, mapped from 0–4 to 0–100; Choice selects a relevance category, attributed evidence and optional counter evidence. Person input also selects an input person's source passage. No router or chat model participates in search scoring. Jev does not generate explanations: results show a sharing value scale description with dated original source and conflicting quotes directly. Explicit refusals, fulfilled needs and incompatible constraints lower sharing value; full transcripts remain available alongside notes. No score threshold filters results; sorting is deterministic and makes no additional model request. Incomplete decisions, invalid choices and invalid citations fail visibly. Missing adapter candidates are retried once without rescoring completed candidates. Calls record actual decision usage and respect workspace credit. Estimates use direct Jev pricing and learn from tagged decision calls, not previous router calls; duration remains a conservative historical estimate pending production calibration. The extraction adapter still requires the general `OPENROUTER_MODEL` setting. Search requests are limited to 10 per user and workspace per minute.

Intel previews estimated USD model cost using scoring batch sizes and observed router rates. Estimates exclude link retrieval and expire after an hour. A link is read once and its text is reused when the search starts.

`EXA_API_KEY` enables public HTTPS content extraction through Exa Contents. `TWITTERAPI_IO_API_KEY` is the optional server only fallback for specific X post URLs. Neither key belongs in client code, committed files, logs or public environment variables. An unreadable link asks the user to paste its content. Links above 20,000 extracted characters are rejected with an excerpt prompt rather than silently truncated. Provider response streams are bounded to two million bytes. Firecrawl is not used.

Search history retains up to 50 finished searches plus active jobs. Matching progress and results are saved privately; opening a result rechecks the current evidence. The user can clear it. Transcript loading uses pages of 10,000 rows within groups of 25 meetings, with at most three groups loading concurrently. It preserves each meeting's transcript ordering and supports collections above 100,000 segments. Matching considers every participant identity from the past three calendar months without keyword retrieval. Full private notes owned by the caller and current followups are provided with dates and cited transcript passages; missing notes fall back to complete transcripts. The window starts at midnight UTC on the corresponding calendar day three months earlier, clamped at month ends. Each batch contains up to 12 candidate identities and 400,000 serialized characters. Recent history for a confirmed identity stays together, selected input evidence accompanies each batch, and up to three scoring requests run concurrently. All scores remain in the results. Access, transcript and note content are rechecked before returning or reopening saved results. An oversized single identity history or a collection above 1,000 meetings still returns an explicit capacity error instead of partial results. Extraction skips individual transcripts above 600,000 serialized characters. These limits are operational bounds, not advertised coverage guarantees.

Local media upload recovery uses authenticated multipart requests; deploy the server before distributing the updated recorder. See [recorder upload recovery](recorder-upload-recovery.md) for scope and storage lifecycle requirements.

Personal meeting language requires migration `0068_user_language_shared_followup`. Apply it with `npm run db:migrate` before deploying the updated web service. Run `npm run inngest:sync` to register `translate-shared-followup` for readers who need a translated copy. Confirm that a reader can change Settings → Preferences → Default language and open the same meeting in either language with identical evidence links.
