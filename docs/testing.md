# Testing Architecture

Personal meeting notes: run `npx vitest run tests/meeting-notes.test.ts tests/meeting-notes-route.test.ts tests/meeting-notes-interactions.test.tsx tests/meeting-page.test.tsx`, followed by `npm run test:migrations`. Checks cover personal scope, inaccessible meetings, stale versions, autosave, refresh preservation, draft recovery, retry, conflict copying with manual fallback, and confirmation before replacing edits. UI verification should include desktop plus 390 px and 320 px layouts, long notes with preserved scroll position, keyboard focus, loading, failed saves, and conflict recovery alongside the transcript. API and storage tests use mocks; they do not prove deployed database policies. After migration and deployment, verify with two signed in readers that each can save and reopen their own notes while neither sees the other reader's notes. Check both a recording and a completed meeting. The migration CI job also runs `tests/meeting-notes-rls.sql` against PostgreSQL to verify author privacy, shared reader writes, stale version protection, revoked access, and MCP exclusion.

Automatic answer regressions: `npx vitest run tests/meeting-note-document.test.ts tests/meeting-note-answers.test.ts tests/meeting-note-answer-route.test.ts tests/openrouter-note-answer.test.ts tests/meeting-note-enhancement-interactions.test.tsx`. Cover transcript source validation, partial evidence, permission and credit checks, changed transcript rejection, debounce and IME behavior, multiple question blocks, direct answer autosave, intentionally cleared answers, protected manual edits, draft recovery, and stale response cancellation. UI review uses the actual meeting page with fixture API responses. Live provider fixture checks verify model behavior separately from authenticated production save and reload. Never treat a fixture or successful deployment as proof of the complete signed in flow.

Tape tests each runtime at the boundary where its behavior can regress. Provider network calls use mocks unless a command is explicitly marked live.

`tests/image-worker-runtime.test.ts` builds the worker and starts it in a separate Node process with real dependencies, then checks `/health`. This catches module export incompatibilities hidden by service mocks. `tests/elevenlabs-transcript-apply.test.ts` rejects Drizzle SQL fragments bound as Neon values and verifies that the active generation filter is compiled into the entity insertion query.

Completion email tests cover UTF8 TXT attachments, complete long input, owner recipient selection, current recording guards, audio batch readiness, duplicate events, frozen retry payloads, provider rejection, expired idempotency windows, and ignoring manual translation. Run `npx vitest run tests/meeting-email.test.ts tests/meeting-email-job.test.ts tests/meeting-email-records.test.ts tests/openrouter-notes.test.ts tests/ingest.test.ts tests/transcript-chunk-worker.test.ts tests/inngest-functions.test.ts tests/migrations.test.ts`. These tests mock database results and provider calls; use the [setup guide](setup.md#meeting-email) for actual delivery verification.

Calendar history repair coverage includes discovering events never imported, Google pagination beyond 2,000 events, the 30 day window, connection ownership, latest Google event details, deleted and rescheduled events, durable per event steps, queue failure reporting, and retrying a partially created meeting without scheduling a bot or reminder. Run `npx vitest run tests/calendar-history-repair.test.ts tests/calendar-auto-join.test.ts tests/calendar-sync-route.test.ts tests/inngest-functions.test.ts tests/google-calendar-events.test.ts tests/calendar-sync-button.test.tsx`.

Calendar import tests also cover invitations with multiple participants but no link or location, historical recovery and retries, personal calendar holds, duplicate participant emails, deleted invitations, declined guests, and excluded bookings.

AI followup coverage includes named subjects without pronouns, exact transcript evidence, provider validation retries, full input limits, source invalidation, management authorization, provider credit, changes during generation, shared reader visibility, retry behavior, and timestamp links. Run `npx vitest run tests/meeting-followup.test.ts tests/meeting-followup-route.test.ts tests/meeting-followup-interactions.test.tsx tests/openrouter-followup.test.ts tests/openrouter-translation.test.ts tests/meeting-page.test.tsx tests/migrations.test.ts`. For live verification, generate from a completed meeting, reload to confirm persistence, open as an existing shared reader, and edit a transcript segment to confirm invalidation. For visual review, check collapsed, empty, generating, populated, failed regeneration, and shared reader states on desktop and mobile using the application font and real transcript content. Confirm the Regenerate icon has an accessible name, timestamp bubbles open on hover and keyboard or touch activation, exact source quotes remain readable, Escape dismisses the bubble, and View in transcript targets the cited segment. Confirm long names and quotes wrap without horizontal overflow. Mocked tests and a local UI preview do not prove deployed database persistence.

## Test Layers

| Layer | Protects | Command |
| --- | --- | --- |
| ESLint | TypeScript and React static rules | `npm run lint` |
| Vitest | Domain rules, access policy, database queries, API routes, Inngest functions, services, and React rendering | `npm run test:coverage` |
| Playwright | Public navigation, sign in, protected redirects, authenticated page rendering, RLS isolation, and desktop and mobile browser flows | `npm run test:e2e` |
| Node test runner | Recall desktop SDK sidecar lifecycle and capture fallback | `npm run test:sidecar` |
| Swift Testing and build | macOS recorder state, permission failures, API requests, scheduling, capture, upload behavior, and executable compilation | `npm run test:swift` |
| Python unittest | MCP authentication, caller scope, SQL safety, media tools, signed upload handoff, and read only database boundaries | `npm run test:mcp` |
| Live calendar probe | Stored production connection, Google token refresh, Calendar read access, Recall connectivity, and recent sync state | `CALENDAR_LIVE_TEST_EMAIL=user@example.com npm run test:calendar-live` |

Playwright starts an isolated Next.js development server on port 3100 unless `PLAYWRIGHT_BASE_URL` points to an existing deployment.

Dashboard scroll restoration is covered by `tests/dashboard-scroll-restoration.test.tsx`,
including history entry isolation, streamed content taking longer than ten seconds,
and cancellation on user interaction. For browser verification, scroll the meeting
index, open a visible meeting, and use browser Back. Check both the scroll position
and the meeting's viewport position. Repeat after reloading the detail page so the
index must load again, and with delayed meeting data. Run this against local fixtures
or an authenticated test environment; component tests do not prove deployed behavior.

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

For MCP meeting upload changes, verify request signatures, completion token binding, web route authorization, exact object validation, idempotent completion, and the Python tool contract:

```bash
npx vitest run tests/mcp-backend-auth.test.ts tests/mcp-upload-routes.test.ts tests/deployment-environment.test.ts
npm run test:mcp
```

Browser tests can identify their telemetry explicitly by setting a UUID in
session storage before the application loads:

```ts
await page.addInitScript(() => {
  sessionStorage.setItem(
    "tape.telemetry.test_session",
    "33333333-3333-4333-8333-333333333333",
  );
});
```

Those events include `test.session.id` and `telemetry.synthetic = true`.

For Recall bot scheduling or meeting chat changes, verify Zoom and Google Meet
callback routing, mention handling, visible provider failure replies, signed
route processing, and OpenRouter tool use:

```bash
npx vitest run tests/deployment-environment.test.ts tests/ingest.test.ts tests/recall-calendar.test.ts tests/recall-chat.test.ts tests/recall-chat-answer.test.ts tests/recall-chat-route.test.ts tests/openrouter-chat.test.ts
```

These tests must keep `RECALL_REALTIME_WEBHOOK_URL` stable when
`NEXT_PUBLIC_APP_URL` points at a development tunnel or is empty. Provider
answer failures must produce a visible retry message in the same direct or room
chat and a structured server error log.

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

CI uses Python 3.14 for MCP dependencies so a newly released Python ABI cannot invalidate the locked binary wheels.

Pull requests and pushes to `main` run four jobs in `.github/workflows/test.yml`:

1. `migration-integrity` checks migration lineage, detects schema drift, replays every migration on an empty PostgreSQL database, and verifies the billing ledger queries.
   It also runs `tests/meeting-insert-rls.sql` to verify meeting creation with
   `INSERT ... RETURNING`, ownership, workspace isolation, administrator access,
   and active versus revoked shares using the application and MCP roles.
2. `web` migrates and seeds the isolated authenticated fixture database when
   its secrets are available, then runs `npm run verify` and Playwright on
   Node.js 24 with ffmpeg.
3. `mac-recorder` runs the sidecar and Swift suites on macOS 15.
4. `mcp` runs the Python suite with local development authentication.

Railway readiness is enforced by the `/api/health/dashboard` check in `railway.web.json`. A deployment becomes active only after the application starts and the database health check succeeds.

## Regression Rules

1. Reproduce a reported defect with a failing test before changing implementation.
2. Test observable behavior and access boundaries, not internal call order alone.
3. Use synthetic people, meetings, links, tokens, and vendor payloads.
4. Mock provider network calls in deterministic suites.
5. Keep the live probe explicit so local and CI tests cannot spend provider quota accidentally.

Replacement audio checks are covered by `tests/meeting-recovery-upload-panel.test.tsx` and `tests/meeting-actions.test.tsx`, including cancelling before upload and submitting the corrected file to the existing meeting. Audio selection prioritizes assets belonging to the active transcript generation before synthesized audio format preference.

Replacement generation tests also cover atomic registration and repeat completion, hiding historical images and duration, ignoring obsolete transcript webhooks, and preventing earlier enrichment runs from overwriting new translation state. Run `npx vitest run tests/meeting-audio-batches.test.ts tests/meeting-recovery-uploads.test.ts tests/meeting-image-route.test.ts tests/meeting-audio-route.test.ts tests/elevenlabs-transcript-apply.test.ts tests/inngest-enrich-transcript.test.ts tests/meeting-translation-jobs.test.ts`.

Multiple account and organization bot regressions: `npx vitest run tests/organization-workspaces.test.ts tests/organization-bot-profiles.test.ts tests/team-settings-access.test.ts tests/google-calendar-oauth.test.ts tests/calendar-oauth-callback-route.test.ts tests/calendar-sync-button-interactions.test.tsx tests/calendar-auto-join.test.ts`. These tests verify local behavior; real Google consent, bot participation, and production domain configuration require separate verification.

Company calendar consolidation is verified against PostgreSQL with `psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file tests/iosf-company-migration.sql`. Run it only against a test database after applying all migrations. The transaction rolls back its fixtures and checks preserved meeting IDs, duplicate historical in person meetings, calendar references, administrator access, bot artwork, and private note isolation. Organization switching also has a rendered regression in `tests/team-settings-page.test.tsx` that checks unsaved names and preferred bot state do not carry into another domain.
