# Testing Architecture

Tape tests each runtime at the boundary where its behavior can regress. Provider network calls use mocks unless a command is explicitly marked live.

## Test Layers

| Layer | Protects | Command |
| --- | --- | --- |
| ESLint | TypeScript and React static rules | `npm run lint` |
| Vitest | Domain rules, access policy, database queries, API routes, Inngest functions, services, and React rendering | `npm run test:coverage` |
| Playwright | Public navigation, sign in, protected redirects, authenticated page rendering, RLS isolation, and desktop and mobile browser flows | `npm run test:e2e` |
| Node test runner | Recall desktop SDK sidecar lifecycle and capture fallback | `npm run test:sidecar` |
| Swift Testing and build | macOS recorder state, permission failures, API requests, scheduling, capture, upload behavior, and executable compilation | `npm run test:swift` |
| Python unittest | MCP authentication, caller scope, SQL safety, media tools, and read only boundaries | `npm run test:mcp` |
| Live calendar probe | Stored production connection, Google token refresh, Calendar read access, Recall connectivity, and recent sync state | `CALENDAR_LIVE_TEST_EMAIL=user@example.com npm run test:calendar-live` |

Playwright starts an isolated Next.js development server on port 3100 unless `PLAYWRIGHT_BASE_URL` points to an existing deployment.

The page rendering contract discovers every `app/**/page.tsx` route and compares
it with the explicit public and authenticated route contracts. Public pages
must render their own heading. Protected pages run with the authenticated
fixture and must render their own page heading rather than the sign in page.
Adding a page without a rendering contract fails Playwright. The migration
integrity job executes the Billing and credits schema queries after replaying
all migrations.

GitHub Actions also runs the authenticated page rendering suite when
`E2E_DATABASE_URL` and `E2E_DATABASE_AUTHENTICATED_URL` are available. The
owner URL is limited to migration and deterministic fixture setup. The
application uses the RLS enforced URL. Playwright signs Neon Auth's short lived
session cache cookie with the CI only cookie secret. Every protected page must
render its own heading without browser or server errors. The dashboard test
also verifies that streamed loading completes and a meeting from another
workspace remains hidden. The suite does not automate Google's interface or add
an authentication bypass route.

Both database secrets must target the dedicated `tape_ci` database. Fixture
setup refuses every other database name. To run the same test locally against
an isolated CI database:

```bash
PLAYWRIGHT_AUTHENTICATED=true \
DATABASE_URL='<tape_ci owner URL>' \
DATABASE_AUTHENTICATED_URL='<tape_ci RLS URL>' \
NEON_AUTH_COOKIE_SECRET='<local test secret with at least 32 characters>' \
npm run db:migrate

PLAYWRIGHT_AUTHENTICATED=true \
DATABASE_URL='<tape_ci owner URL>' \
npm run test:e2e:seed

PLAYWRIGHT_AUTHENTICATED=true \
DATABASE_URL='<tape_ci owner URL>' \
DATABASE_AUTHENTICATED_URL='<tape_ci RLS URL>' \
NEON_AUTH_COOKIE_SECRET='<local test secret with at least 32 characters>' \
npm run test:e2e
```

## Release Gates

The portable gate runs lint, Vitest coverage, the production build, sidecar tests, and MCP tests:

```bash
npm run verify
```

On macOS, the complete gate adds Swift and Playwright:

```bash
npm run verify:all
```

Run a focused suite while developing, then run the applicable release gate before handing off the change.

For long recording transcription changes, verify the 60 minute routing boundary, overlap ownership, synchronous ElevenLabs file upload, web fan out, and Railway worker checkpoints:

```bash
npx vitest run tests/transcript-chunking.test.ts tests/transcript-chunk-worker.test.ts tests/elevenlabs-vendor.test.ts tests/inngest-functions.test.ts tests/image-worker.test.ts
```

For telemetry changes, run the deterministic signal, redaction, browser intake,
and server exporter tests:

```bash
npx vitest run tests/telemetry-config.test.ts tests/telemetry-client.test.ts tests/telemetry-route.test.ts tests/telemetry-server.test.ts
```

After deployment, generate one page view and one safe test error. In SigNoz,
filter logs by resource attribute `service.name = tape-web`, then confirm
`frontend.page_view` and the test error are present. Confirm a Next.js request
trace for the same service separately. A healthy dashboard alone does not prove
that the OTLP collector received either signal.

## Coverage Contract

Vitest measures application, component, Inngest, library, proxy, and service code. Shared UI primitives, layout shells, and type declarations are excluded. Current minimums are:

| Metric | Minimum |
| --- | ---: |
| Branches | 67 percent |
| Functions | 77 percent |
| Lines | 80 percent |
| Statements | 74 percent |

These thresholds are repository wide regression floors, not a substitute for focused tests. `tests/test-suite-health.test.ts` also requires every API route to have a direct route test or an explicit thin adapter assertion.

## Live Calendar Probe

The live calendar command is intentionally outside `verify` and CI because it requires a connected account and real provider credentials.

```bash
CALENDAR_LIVE_TEST_EMAIL=user@example.com npm run test:calendar-live
```

The probe fails when its target email or required credentials are missing. It refreshes the stored Google token and performs read only Google Calendar and Recall checks without changing calendar events. Load credentials from ignored local configuration or an explicitly controlled secret environment.

## Continuous Integration

Pull requests and pushes to `main` run four jobs in `.github/workflows/test.yml`:

1. `migration-integrity` checks migration lineage, detects schema drift, replays every migration on an empty PostgreSQL database, and verifies the billing ledger queries.
2. `web` migrates and seeds the isolated authenticated fixture database when
   its secrets are available, then runs `npm run verify` and Playwright on
   Node.js 24 with ffmpeg.
3. `mac-recorder` runs the sidecar and Swift suites on macOS 15.
4. `mcp` runs the Python suite with local development authentication.

Vercel readiness is checked separately after a deployment event. `.github/workflows/vercel-dashboard-check.yml` calls `/api/health/dashboard` and publishes the SHA status named `Vercel - meeting-note: dashboard`.

## Regression Rules

1. Reproduce a reported defect with a failing test before changing implementation.
2. Test observable behavior and access boundaries, not internal call order alone.
3. Use synthetic people, meetings, links, tokens, and vendor payloads.
4. Mock provider network calls in deterministic suites.
5. Keep the live probe explicit so local and CI tests cannot spend provider quota accidentally.
