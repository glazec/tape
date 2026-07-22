# Testing Architecture

Tape tests each runtime at the boundary where its behavior can regress. Provider network calls use mocks unless a command is explicitly marked live.

## Test Layers

| Layer | Protects | Command |
| --- | --- | --- |
| ESLint | TypeScript and React static rules | `npm run lint` |
| Vitest | Domain rules, access policy, database queries, API routes, Inngest functions, services, and React rendering | `npm run test:coverage` |
| Playwright | Public navigation, sign in, protected redirects, and desktop and mobile browser flows | `npm run test:e2e` |
| Node test runner | Recall desktop SDK sidecar lifecycle and capture fallback | `npm run test:sidecar` |
| Swift Testing | macOS recorder state, API requests, scheduling, capture, and upload behavior | `npm run test:swift` |
| Python unittest | MCP authentication, caller scope, SQL safety, media tools, and read only boundaries | `npm run test:mcp` |
| Live calendar probe | Stored production connection, Google token refresh, Calendar read access, Recall connectivity, and recent sync state | `CALENDAR_LIVE_TEST_EMAIL=user@example.com npm run test:calendar-live` |

Playwright starts an isolated Next.js development server on port 3100 unless `PLAYWRIGHT_BASE_URL` points to an existing deployment.

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

1. `migration-integrity` checks migration lineage, detects schema drift, and replays every migration on an empty PostgreSQL database.
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
