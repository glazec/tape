# Testing Architecture

Tape tests each runtime at the boundary where its behavior can regress. Provider network calls use mocks unless a command is explicitly marked live.

## Test Layers

| Layer | Protects | Command |
| --- | --- | --- |
| ESLint | TypeScript and React static rules | `npm run lint` |
| Vitest | Domain rules, access policy, database queries, API routes, Inngest functions, services, and React rendering | `npm run test:coverage` |
| Playwright | Public navigation, sign in, protected redirects, and desktop and mobile browser flows | `npm run test:e2e` |
| Node test runner | Recall desktop SDK sidecar lifecycle and capture fallback | `npm run test:sidecar` |
| Swift Testing and build | macOS recorder state, permission failures, API requests, scheduling, capture, upload behavior, and executable compilation | `npm run test:swift` |
| Python unittest | MCP authentication, caller scope, SQL safety, media tools, and read only boundaries | `npm run test:mcp` |
| Live calendar probe | Stored production connection, Google token refresh, Calendar read access, Recall connectivity, and recent sync state | `CALENDAR_LIVE_TEST_EMAIL=user@example.com npm run test:calendar-live` |

Playwright starts an isolated Next.js development server on port 3100 unless `PLAYWRIGHT_BASE_URL` points to an existing deployment.

The page load smoke suite discovers every `app/**/page.tsx` route, including Billing and credits, and rejects server errors. Billing and credits also has a direct authenticated rendering test, while the migration integrity job executes its required ledger queries after replaying all migrations.

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
2. `web` runs `npm run verify` and Playwright on Node.js 24 with ffmpeg.
3. `mac-recorder` runs the sidecar and Swift suites on macOS 15.
4. `mcp` runs the Python suite with local development authentication.

Vercel readiness is checked separately after a deployment event. `.github/workflows/vercel-dashboard-check.yml` calls `/api/health/dashboard` and publishes the SHA status named `Vercel - meeting-note: dashboard`.

## Regression Rules

1. Reproduce a reported defect with a failing test before changing implementation.
2. Test observable behavior and access boundaries, not internal call order alone.
3. Use synthetic people, meetings, links, tokens, and vendor payloads.
4. Mock provider network calls in deterministic suites.
5. Keep the live probe explicit so local and CI tests cannot spend provider quota accidentally.
