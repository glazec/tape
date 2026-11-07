# Testing Architecture

Note moments and recording import: run `npx vitest run tests/note-moments.test.ts tests/note-moments-interactions.test.tsx tests/note-moment-navigation.test.tsx tests/recording-file-time.test.ts tests/recording-import.test.tsx tests/upload-dropzone.test.tsx tests/upload-meeting-candidates-route.test.ts tests/upload-complete-route.test.ts tests/upload-audio-route.test.ts`. These cover grammar, IME, marker edits, saved anchors, gap mapping, shared and composed transcript navigation, date parsing, timezone transitions, local seeking, deliberate destination choice, and both upload transports. The PostgreSQL suite `tests/upload-recording-import.integration.test.ts` uses the same guarded disposable database environment as recorder target integration below; it covers competing imports, recorder claims, permissions, rollback, and idempotency. Do not point it at production.

Real component preview: run `node tests/fixtures/note-moments/serve.mjs`, then `node tests/fixtures/note-moments/verify.mjs`. The verification expects the supplied sample at `/Users/glaze/Downloads/Oct 19 at 11-41 AM.m4a`; adjust the path for another local fixture. It checks actual local media playback and seeking, rendered 1440 px, 390 px and 320 px layouts, transcript focus, and fixture save/reload. API responses and note persistence use local fixtures, so this does not establish authenticated production persistence, calendar freshness, object storage delivery, or provider transcription. No sample recording is included in source control.

Transcript polish: run `npx vitest run tests/meeting-translation.test.ts tests/openrouter-translation.test.ts tests/inngest-enrich-transcript.test.ts tests/inngest-functions.test.ts`. Regressions cover short Chinese and English cleanup, grammatical edits, tiny fragment protection, segment alignment, strict output schema, and original text fallback. Live model checks should include rambling speech, mixed languages, corrected numbers, uncertainty, negation, and conditional sequencing. Mocked tests verify request and parsing behavior, not editorial quality or production deployment.

Markdown notes: run `npx vitest run tests/note-markdown.test.tsx tests/meeting-notes-interactions.test.tsx tests/note-moments-interactions.test.tsx tests/meeting-note-enhancement-interactions.test.tsx`. Cover HTML and spreadsheet table paste, selection replacement, table boundaries, save and reload, safe rendering, preview navigation, and question handling inside code fences. The component fixture uses mocked persistence; this does not prove a production deployment.

Personal meeting notes: run `npx vitest run tests/meeting-notes.test.ts tests/meeting-notes-route.test.ts tests/meeting-notes-interactions.test.tsx tests/meeting-page.test.tsx`, followed by `npm run test:migrations`. Checks cover personal scope, inaccessible meetings, stale versions, autosave, refresh preservation, draft recovery, retry, conflict copying with manual fallback, and confirmation before replacing edits. UI verification should include desktop plus 390 px and 320 px layouts, long notes with preserved scroll position, keyboard focus, loading, failed saves, and conflict recovery alongside the transcript. `tests/meeting-note-enhancement-interactions.test.tsx` also covers HTTP 401 during note loading, saving, transcript checking, and answer generation: sign in recovery, stopped background requests, continued draft retention, and saving the recovered draft after authentication. `tests/meeting-note-answers.test.ts` and `tests/openrouter-note-answer.test.ts` cover one bounded correction of invalid generated citations, continued rejection of unsupported quotes, and the shared 30 second deadline. API and storage tests use mocks; they do not prove deployed database policies. After migration and deployment, verify with two signed in readers that each can save and reopen their own notes while neither sees the other reader's notes. Check both a recording and a completed meeting. The migration CI job also runs `tests/meeting-notes-rls.sql` against PostgreSQL to verify author privacy, shared reader writes, stale version protection, revoked access, and MCP exclusion.

Automatic answer regressions: `npx vitest run tests/meeting-note-document.test.ts tests/meeting-note-answers.test.ts tests/meeting-note-answer-route.test.ts tests/openrouter-note-answer.test.ts tests/meeting-note-enhancement-interactions.test.tsx`. Cover transcript source validation, partial evidence, permission and credit checks, changed transcript rejection, debounce and IME behavior, multiple question blocks, direct answer autosave, intentionally cleared answers, protected manual edits, draft recovery, and stale response cancellation. UI review uses the actual meeting page with fixture API responses. Live provider fixture checks verify model behavior separately from authenticated production save and reload. Never treat a fixture or successful deployment as proof of the complete signed in flow.

Tape tests each runtime at the boundary where its behavior can regress. Provider network calls use mocks unless a command is explicitly marked live.

`tests/image-worker-runtime.test.ts` builds the worker and starts it in a separate Node process with real dependencies, then checks `/health`. This catches module export incompatibilities hidden by service mocks. `tests/elevenlabs-transcript-apply.test.ts` rejects Drizzle SQL fragments bound as Neon values and verifies that the active generation filter is compiled into the entity insertion query.

Completion email tests cover UTF8 TXT attachments, complete long input, owner recipient selection, current recording guards, audio batch readiness, duplicate events, frozen retry payloads, provider rejection, expired idempotency windows, and ignoring manual translation. Run `npx vitest run tests/meeting-email.test.ts tests/meeting-email-job.test.ts tests/meeting-email-records.test.ts tests/openrouter-notes.test.ts tests/ingest.test.ts tests/transcript-chunk-worker.test.ts tests/inngest-functions.test.ts tests/migrations.test.ts`. These tests mock database results and provider calls; use the [setup guide](setup.md#meeting-email) for actual delivery verification.

Calendar history repair coverage includes discovering events never imported, Google pagination beyond 2,000 events, the 30 day window, connection ownership, latest Google event details, deleted and rescheduled events, durable per event steps, queue failure reporting, and retrying a partially created meeting without scheduling a bot or reminder. Run `npx vitest run tests/calendar-history-repair.test.ts tests/calendar-auto-join.test.ts tests/calendar-sync-route.test.ts tests/inngest-functions.test.ts tests/google-calendar-events.test.ts tests/calendar-sync-button.test.tsx`.

Calendar import tests also cover invitations with multiple participants but no link or location, historical recovery and retries, personal calendar holds, duplicate participant emails, deleted invitations, declined guests, and excluded bookings.

Potential connections regression coverage is in `tests/meeting-connections.test.ts`, `tests/meeting-followup-interactions.test.tsx` and `tests/transcript-viewer-interactions.test.tsx`. Verify partial identities, person/team/project entries, original source text, anchor validation, legacy version 3 summaries, source invalidation, rename persistence, single segment attribution, optimistic group changes and rollback. Open a real external meeting on desktop and mobile, expand extra connections and inspect source quotes. A project mention must not imply a personal relationship or introduction commitment.

Connection correction coverage also includes tests/meeting-connections-route.test.ts: authentication, reader denial, input limits, inaccessible attribution, stale snapshots, concurrent writes, source changes, successful persisted readback and database errors. Component tests verify internal speaker ordering, mutual labels, editable identity and description, moving a connection between speakers, revision refresh, draft preservation through server refresh and conflicts, deferred updates on cancel, later speaker changes and reader controls. Raw AI mutual markers are not confirmed; manual corrections remain. Deduplicated transcript lines keep every cited source target. Regeneration tests verify correction preservation and JSON compare-and-swap. Browser verification should cover the edit dialog at desktop and mobile widths with real meeting content.

AI followup coverage includes research evidence validation, legacy summary compatibility, complete clipboard prompts, clipboard success and failure feedback, shared reader copying, and named subjects without pronouns, exact transcript evidence, provider validation retries, full input limits, source invalidation, management authorization, provider credit, changes during generation, shared reader visibility, retry behavior, and timestamp links. Run `npx vitest run tests/meeting-followup.test.ts tests/meeting-followup-route.test.ts tests/meeting-followup-interactions.test.tsx tests/openrouter-followup.test.ts tests/openrouter-translation.test.ts tests/meeting-page.test.tsx tests/migrations.test.ts`. For live verification, generate from a completed meeting, reload to confirm persistence, open as an existing shared reader, and edit a transcript segment to confirm invalidation. For visual review, check collapsed, empty, generating, populated, failed regeneration, and shared reader states on desktop and mobile using the application font and real transcript content. Confirm the Regenerate icon has an accessible name, timestamp bubbles open on hover and keyboard or touch activation, exact source quotes remain readable, Escape dismisses the bubble, and View in transcript targets the cited segment. Confirm long names and quotes wrap without horizontal overflow. For Potential research, activate a paragraph by mouse, touch, Enter and Space, paste the result into a plain text field, and verify the question, meeting title and date, attributed source quotes, context and evidence requests. The success toast must follow successful copying and disappear after four seconds; denied clipboard access must show an error without claiming success. Source controls must not copy. Verify each copy button exposes the evidence request as its accessible description and that the copy status live region exists before interaction. Check research is hidden when no questions remain. Mocked tests and a local UI preview do not prove deployed database persistence.

Session and sharing regressions: run `npx vitest run tests/dashboard-error.test.tsx tests/middleware.test.ts tests/share-dialog-interactions.test.tsx tests/meeting-share-service.test.ts tests/share-recipient-suggestions.test.ts`. For real RLS checks, set `TAPE_SHARING_TEST_DATABASE` to a migrated disposable local PostgreSQL database named `tape_activation_test` or the CI database `meeting_note`. Fixtures roll back. Tests cover new internal and external recipients, multiple organizations, calendar addresses, deduplication, and unrelated tenant exclusion. Run `npm run test:swift` for desktop session classification and native compilation. Production browser sign in, native permission prompts, and release installation still require live verification.

CI sets `PLAYWRIGHT_CHANNEL=chrome` to use the GitHub runner's installed Chrome. Local runs keep the bundled Chromium default unless this variable is set.

## Test Layers

Desktop meeting selection UX regressions include creation date fallback and unavailable target explanations against isolated PostgreSQL, definite rejection versus unknown network outcome, and preserving a completed upload receipt when destination confirmation arrives late. Snapshot fixtures include repeated meeting titles, an undated manual record, a recording conflict, and an upload receipt beneath a different upcoming meeting. Verify keyboard search, arrow navigation, Return, Escape focus restoration, and VoiceOver on the installed app before a UX parity claim. Source inspection and rendered fixtures do not measure recording latency or completion through a real provider.

Automatic monitoring regressions in `tests/local-recorder-targets.integration.test.ts` execute the actual suggestion and missed bot query predicates against isolated PostgreSQL. They use materialized effective access plus participant source grants and cover member, admin and owner roles, personally owned meetings, manual shares, revoked participation, revoked effective access, workspace separation, and reauthorization of queued alerts. CI runs these cases and the destination lifecycle regressions against a disposable database. A concurrent switch and Stop must always finish successfully with one frozen destination. Admin access alone must not suggest a colleague’s meeting.

Desktop destination and resume regressions run with `npx vitest run tests/local-recorder-targets.test.ts tests/local-recorder-targets.integration.test.ts tests/local-recorder-routes.test.ts tests/local-recorder-records.test.ts tests/recording-timeline.integration.test.ts tests/recall-meetings.test.ts tests/transcription-records.test.ts tests/elevenlabs-transcript-apply.test.ts tests/migrations.test.ts`. The two integration files require `TAPE_RECORDER_TEST_DATABASE` pointing to a disposable PostgreSQL database named `tape_workflow_test` on `127.0.0.1`; they refuse other hosts and database names, create isolated schemas, and remove those schemas afterward. Without that variable the database cases are skipped. Coverage includes lost start responses, destination access and credit rules, switch versus stop races, frozen attempt replay, immediate resume, SDK completion routing, reversed upload arrival, pending and failed transcription, preservation of edited segments, and transcript generation boundaries. Provider calls are mocked; these checks do not establish successful live meeting capture or delivery.

For the native workflow, run `npm run test:swift` and `npm run test:sidecar`. The Swift gate includes an isolated process harness using the actual SDK controller and a fake sidecar, covering process exit during startup and Stop, missing acknowledgments, and a closed control pipe. It does not capture audio or contact a provider. Verify the current event, next event, title selector, new meeting, settings, and end prompt with `TAPE_DESKTOP_SNAPSHOT_DIR` using the debug executable. Before release, exercise an authenticated Zoom call and a Google Meet call: record the displayed event, move the active capture to another meeting, stop, and immediately resume a recent event while the first upload drains. Confirm both segments and their transcripts appear in capture order. Test an absent bot notification, dismissal without recording, meeting window closure, 60 seconds of silence after a scheduled end, and 5 minutes of silence for an ad hoc meeting. Verify Keep recording, unrelated window closure, stale notifications, denied permissions, loss of network, and restart with pending upload recovery. Fixture snapshots and lifecycle tests do not replace these live checks.

| Layer | Protects | Command |
| --- | --- | --- |
| ESLint | TypeScript and React static rules | `npm run lint` |
| Vitest | Domain rules, access policy, database queries, API routes, Inngest functions, services, and React rendering | `npm run test:coverage` |
| Playwright | Public navigation, sign in, protected redirects, authenticated page rendering, RLS isolation, and desktop and mobile browser flows | `npm run test:e2e` |
| Node test runner | Recall desktop SDK sidecar lifecycle and capture fallback | `npm run test:sidecar` |
| Swift Testing and build | macOS recorder state, permission failures, API requests, scheduling, capture, upload behavior, executable compilation, permission callback and audio waveform probes | `npm run test:swift` |
| Python unittest | MCP authentication, caller scope, SQL safety, media tools, signed upload handoff, and read only database boundaries | `npm run test:mcp` |
| Live calendar probe | Stored production connection, Google token refresh, Calendar read access, Recall connectivity, and recent sync state | `CALENDAR_LIVE_TEST_EMAIL=user@example.com npm run test:calendar-live` |

`npm run test:mcp` also covers persistent Google OAuth refresh sessions in `test_persistent_google_oauth.py`. The tests simulate 31, 400, and 4,000 days, reopen encrypted storage, and check refresh rotation, replay rejection, client binding, short access token expiry, and Google rejection. These tests use simulated provider responses; they do not prove a real Google authorization remains valid for that duration.

Playwright starts an isolated Next.js development server on port 3100 unless `PLAYWRIGHT_BASE_URL` points to an existing deployment. CI sets `PLAYWRIGHT_PRODUCTION=true` to test the production bundle from `npm run verify`; authenticated tests serve that bundle over local HTTPS for secure cookies. To run this mode locally, build first, then run `PLAYWRIGHT_PRODUCTION=true npm run test:e2e` with the same environment.

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
owner URL creates dedicated database auth sessions and deterministic fixtures. Product data access
uses the RLS enforced URL. Playwright signs the database session token
with the CI only cookie secret. Every protected page must
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
npx vitest run tests/telemetry-config.test.ts tests/telemetry-client.test.ts tests/telemetry-route.test.ts tests/telemetry-server.test.ts tests/sentry-handled-errors.test.ts tests/image-worker-runtime.test.ts
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

## Sentry delivery verification

With `NEXT_PUBLIC_SENTRY_DSN` configured locally, run:

```bash
npm run verify:sentry -- server
npm run verify:sentry -- worker
```

These commands send synthetic handled, console, and final job errors through
the real reporting code, without calling the database. They use the
`coverage-verification` environment and print event IDs. Receipts are written to
`/tmp/tape-sentry-server-verification.json` and
`/tmp/tape-sentry-worker-verification.json`.

For native delivery, set `TAPE_SENTRY_VERIFY_DSN` to the public project DSN and
`TAPE_SENTRY_VERIFY_ID` to a new UUID, then run:

```bash
swift test --package-path mac/LocalRecorder --filter recorderSentryDeliveryVerification
```

The opt in test initializes the SDK on the main actor and invokes the same
reporter used by desktop failure catches. It writes the event ID to
`/tmp/tape-desktop-sentry-event.json`. Ordinary tests send no events.

Read each event back through the authenticated Sentry project event API. Check
its environment, operation, release where applicable, and absence of the private
test marker. An event ID or successful flush alone is not proof of receipt.
Local sender verification does not prove that production has deployed the code,
that users have installed the new desktop version, or that a real audio capture
succeeded. Swift dependency checkouts under `.build` are excluded from JavaScript
test discovery and linting.

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

## Organization workflow checks

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run test:migrations`. Organization regressions cover bot choices within one company, unauthorized choices, cancellation, nearby meeting confirmation, stored bot profiles, workspace switching, and API membership checks. Test desktop pairing and MCP uploads with two memberships. Browser checks using local provider responses establish UI behavior only; a deployed authenticated meeting join is a separate release check.

## Meeting continuity verification

Run `npx vitest run tests/meeting-continuation-policy.test.ts tests/meeting-continuation.test.ts tests/meeting-continuity-routes.test.ts tests/meeting-continuity-interactions.test.tsx tests/meeting-composed-transcripts.test.tsx tests/remembered-speaker-names.test.ts` for the deadline, dispatch, API boundaries, source composition, and email identity regressions. The existing speaker route, meeting page, export, followup, and bot recovery suites cover the integrations.

Replay migrations in an isolated PostgreSQL database, then run `psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/meeting-continuity.sql`. The script uses a transaction and rolls back its fixtures. It checks pending merges, reverse merge rejection, independent source access, durable continuation recipients, strict expiry, duplicate claims, and retained bot lineage. CI runs it after migration replay. `tests/meeting-bot-lineage.test.ts` also checks simultaneous callbacks after a lost provider response: both events from the accepted bot remain valid, while a different bot is rejected. Never run fixture SQL on production.

For the actual React component preview, run `node tests/fixtures/meeting-continuity/serve.mjs` and open `http://127.0.0.1:8777`. Run `node tests/fixtures/meeting-continuity/verify.mjs` for desktop and mobile screenshots, keyboard focus, expiry, merge undo, real notes autosave through mocked persistence, and exact email correction. The fixture is localhost only and uses example data and mocked APIs. It does not replace authenticated database and provider verification.

## Playback waveform

Run `npx vitest run tests/audio-waveform.test.ts tests/audio-waveform-integration.test.ts tests/meeting-audio-route.test.ts tests/transcript-viewer.test.tsx tests/transcript-viewer-interactions.test.tsx`. The integration test runs the bundled ffmpeg binary against downloaded synthetic audio. These cover quiet, loud, and silent audio, sparse speech, transient peaks, mobile resampling, the authenticated waveform response, source cache invalidation, bounded decoder concurrency, long recordings, and independent playback after waveform failure.

Verify a real recording longer than 45 minutes on desktop and mobile. Its audio request with `waveform=1` should return measured levels, without downloading decoded PCM into the browser. Confirm quiet passages have shorter bars and playback and seeking still work. The server needs `FFMPEG_PATH`, `FFMPEG_BIN`, the bundled ffmpeg executable, or ffmpeg on PATH. Generation is bounded to two processes per server process, a 256 MiB download limit, a 60 second download timeout, a 120 second decoder timeout, and 16 MiB of analysis output; failures leave the transcript activity fallback available. Combined recordings retain their transcript activity waveform.
## Recall delivery regression checks

`tests/elevenlabs-transcripts.test.ts` also covers the top-level `webhook_error` payload, preserving the provider error and marking the job failed instead of leaving an accepted request running. Clipboard fallback assertions wait for the selection effect before checking the selected range.

`tests/recall-meeting-reconciliation.test.ts` covers lost completion notifications, waiting rooms, provider errors, and selection of interrupted queued jobs. Calendar route tests verify that the common signed Recall endpoint also accepts Calendar V2 events. Transcription record tests cover reusing a queued job after a failed dispatch. Library tests keep started meetings visible even beside a future meeting with the same title. Production closure requires provider delivery readback, a completed Inngest recovery run, and persisted transcript segments on each recovered meeting.

Chunked transcription registers a terminal Inngest failure callback so exhausted step retries mark the job failed even when the replayed handler attempt remains zero. `tests/image-worker.test.ts` covers that failure callback.

Desktop UX verification: the Swift regression tests distinguish a missing workflow route (HTML 404) from a missing meeting (JSON 404), sign in failures, and uncertain retries. Verify the recording failure remains visible after Refresh, and open and close settings repeatedly to confirm the gear and summary stay in place. The `recording-unavailable` snapshot includes a successful calendar refresh after a failed start. Run `mac/LocalRecorder/script/snapshot.sh /tmp/tape-desktop-snapshots` for long meeting titles and account settings in the compact 340 point window. Check light and dark appearances. Native source meters expose percentage values to accessibility, and the waveform follows both microphone and Mac sound. Account decoding accepts older servers without the optional identity field; route tests bind the displayed email and workspace to the authenticated device membership.

Web session persistence is covered by `tests/auth-server.test.ts` against a disposable PostgreSQL database. Set `AUTH_TEST_DATABASE_URL` to an empty test database and run `npx vitest run tests/auth-server.test.ts`. The suite creates and removes its own auth tables. CI runs it on a separate database. It checks real Better Auth handlers, legacy identity migration, 180 day cookie and database expiry, server recreation, simulated day 179 and day 181, logout revocation, tampered cookies, revoked legacy replay, banned users, and Google callback routing. Provider responses are simulated locally; production verification additionally requires real Google login and a service restart while retaining the same session.

Desktop session lifetime is checked by `tests/local-recorder-auth.test.ts` at credential issuance. `tests/local-recorder-session-lifetime.sql` replays migration `0064` twice and checks active session extension, retained token and device hashes, unchanged login date, and preservation of expired, revoked, and longer sessions. CI runs this SQL on its disposable PostgreSQL database.

Astra review on 2026-10-31 also checks conflict recovery after reordered entries, manual-only Mutual confirmation, source anchors after deduplication, and truthful share-access copy. The speaker identity gap from that review is covered by the speaker identity checks below. Delayed automatic followup visibility after transcription is ready remains a separate acceptance concern. Local component fixtures do not establish production persistence or multi-account permissions.

## Intel verification

Run `npx vitest run tests/intel-*.test.ts tests/intel-interactions.test.tsx tests/intel-page.test.tsx tests/migrations.test.ts`, `npx tsc --noEmit`, and `npx drizzle-kit check`. `tests/intel-scoring.test.ts` checks direct Jev Decisions requests, ordered score conversion, retained zeros, target and input evidence choices, counter evidence, usage accounting and provider rejection. The focused suite covers scoped identities, canonical composed sources, inaccessible source rejection, replaced transcripts, fabricated references, extraction verification failure, all recent participant coverage, full notes, zero relevance retention, missing scores, URL substitution, source speaker exclusion, authorization changes during matching, and retry checkpoint persistence.

Run `node tests/fixtures/intel/serve.mjs`, then `node tests/fixtures/intel/verify.mjs` to exercise the real React component with explicitly fictional fixtures on desktop and mobile. The check covers source disclosure, Intel to People to Intel navigation, identity confirmation, cost previews before dispatch, link failure recovery, dialog dismissal and horizontal overflow. It does not prove deployed authentication or production meeting data.

Optional live synthetic model verification: load valid OpenRouter environment variables and run `node --import tsx scripts/verify-intel-model.ts`. It checks eight adversarial claims covering invented numbers, negation, attribution, timing and stale intent, with no real transcript data or database writes. Passing this small suite is not a measured comparison with Granola or Otter.

The Intel database integration suite is opt in. Apply the repository SQL migrations to an isolated local PostgreSQL database, then set `INTEL_TEST_DATABASE_URL` to its localhost URL and run `npx vitest run tests/intel-database.integration.test.ts`. The test seeds synthetic data in a transaction and rolls it back. It exercises real corpus SQL, JSONB extraction readback, job completion without a browser, saved result invalidation, history pruning and row level security under `tape_authenticated`. Remote database URLs are rejected. Add `INTEL_LIVE_MODEL_CHECK=1` and valid OpenRouter credentials to exercise relevance scoring against that synthetic corpus with the real model.

Additional regressions cover immediate preparation feedback, truthful queue states, late catalog response races, bounded concurrent transcript scans, small corpus retrieval without shared words, complete JSON fences, oversized links, bounded provider reads, background dispatch failure, matching progress, browser closure and resumption, newly indexed result continuation, and deduplication and source dates for merged contacts.

Recorder multipart regression checks: `npx vitest run tests/local-recorder-multipart.test.ts tests/local-recorder-multipart-route.test.ts tests/local-recorder-routes.test.ts tests/local-recorder-records.test.ts tests/r2.test.ts`, followed by `npm run test:swift`. The native recovery test verifies that a persisted session skips an uploaded part. See [recorder upload recovery](recorder-upload-recovery.md) for the required live interruption check.

The native gate also runs `mac/LocalRecorder/script/test_compressed_audio.mjs`, compiling the actual writer, converter, and synthesizer and checking AAC bitrate, mono output, and duration with 48 kHz and 44.1 kHz stereo inputs. `tests/local-recorder-media-request.test.ts` verifies compressed audio and screenshot metadata; completion tests check atomic screenshot registration and missing image rejection. Screenshot change detection tests cover first frames, slides, small rendering noise, and queue timestamps.

## Desktop permission continuity

Run `node --test mac/LocalRecorder/script/test_permissions.mjs` for actual app method probes covering fresh permission state, retained grants after updates, and stale Accessibility or screen capture state. Refresh reads system authorization without prompting or resetting grants; cached UI approval never overrides a denied system result. These tests substitute system decisions and cannot prove live macOS permission continuity.

Run `mac/LocalRecorder/script/verify_release_identity.sh "/path/to/Tape Desktop.app"` on the old and new release. Both must pass with the same pinned certificate and designated requirement. A newly created certificate with the same display name must fail. Never reset permissions as part of an ordinary launch or update.

For release acceptance, use a clean macOS VM snapshot to install in `/Applications`, grant access once, and verify microphone, system audio and Accessibility. Update that same installation through Sparkle without changing grants; verify all permissions and actual capture again without a new authorization prompt. Repeat a first install after restoring the clean snapshot. Keep a separate stale grant test for the explicit recovery path. A restart of an already authorized installation is useful evidence but does not replace the clean install and update tests.

The native gate also runs `mac/LocalRecorder/script/test_microphone_start.mjs`. It compiles the actual microphone controller against fake audio devices to verify recovery from voice processing setup and engine start failures, selected device preservation, cleanup of failed taps, retry failure propagation, and repeated stop. It does not prove physical microphone capture.

To check personal meeting language and shared followups, run `npx vitest run tests/user-language-route.test.ts tests/followup-language-copy.test.ts tests/meeting-followup-generation.test.ts`. Set `FOLLOWUP_TEST_DATABASE_URL` to a disposable local PostgreSQL database and run `npx vitest run tests/followup-lease.integration.test.ts` to verify migration backfill and concurrent generation claims. The integration test creates and removes its own schema.

Recent ranking regression: `npx vitest run tests/intel-recent-ranking.test.ts tests/intel-interactions.test.tsx`. These tests cover full notes, source passages, every recent candidate, confirmed identity history, retained zero scores and source changes during scoring.

Recipient evaluation: run `node --import=tsx scripts/eval-intel-recipients.ts` for deterministic evidence coverage, or `node --env-file-if-exists=.env.local --import=tsx scripts/eval-intel-recipients.ts --live` for actual recipient scoring. It uses synthetic data and makes no database writes. Thirteen cases cover notes omissions, reversals, attribution, geography, Chinese requests, same names, complementary offers, embedded instructions, no suitable recipients, selected intel source exclusion and 25 candidates across three batches. Output includes each check, provider reported cost, scoring latency and result text. Strong expected recipients must rank first and score at least 50; explicitly unsuitable recipients must score at most 25. These are evaluation expectations, not product filtering thresholds. Inspect the displayed quotes for usefulness.

On November 7, 2026, the original scorer passed 3/13 scenarios after evidence preservation; the revised scorer passed 13/13 in three consecutive runs, costing $0.00471954 per run. A shorter prompt passed 12/13 and was rejected. The local credential returned HTTP 401; live evaluation used the existing configured service credential without changing configuration or writing production data. See [recipient evaluation results](evals/intel-recipients.md) for artifacts and limitations. Full transcript preservation can increase input cost and trigger the existing oversized history limit.
## Speaker person identity

Run `npx vitest run tests/speaker-*.test.ts tests/speaker-*.test.tsx tests/transcript-viewer*.test.tsx tests/intel-person-identity.test.ts tests/meeting-followup-identity.test.ts tests/speaker-identity-context.test.ts`. Coverage includes explicit name/email selection, persisted links, multiple associated emails, single line scope, identical names, concurrent edits, preferred name refresh, canonical legacy hashes and attribution invalidation.

Replay all migrations into a disposable local PostgreSQL database, then set `SPEAKER_TEST_DATABASE_URL` to that database and run `npx vitest run tests/speaker-identity-database.integration.test.ts`. Remote hosts are rejected. The suite rolls back its fixtures and checks actual authenticated role permissions, shared readers, contact isolation, stable ingestion groups, same mailbox contacts, stale revisions, assignment history and replacement generations. Run `npm run test:migrations` for journal, snapshot and schema drift checks.

Run `node tests/fixtures/speaker-identity/serve.mjs` and then `node tests/fixtures/speaker-identity/verify.mjs` for desktop and mobile interaction checks with fictional data. This exercises the actual component and checks browser errors and overflow; it does not establish production migration or authenticated persistence. Production rollout still needs migration application and a real save, reload, Change person and Unlink check in an authorized meeting.

Before applying migration 0070 in a disposable database, run `psql "$TEST_DATABASE_URL" --set ON_ERROR_STOP=1 --file tests/speaker-identity-backfill.sql`. It checks historical source preservation, exact groups across jobs, distinct null and empty labels, and no inferred contacts. The migration and fixtures roll back. CI runs this check during migration replay and then the actual role integration suite.

Followup provider routing is covered by `tests/openrouter-followup.test.ts`: gateway success, the 30 second timeout configuration, HTTP failure, empty or incomplete output, invalid JSON and evidence, OpenRouter fallback, and credential isolation. Live provider probes use synthetic transcripts; unit tests do not establish provider availability.

`tests/ai-gateway-workflows.test.ts` covers Luna low translations and chat, medium note answers, citation and completeness fallback, Responses web tool round trips, timeout fallback, and preserving non-Luna providers. Intel extraction routing is checked in `tests/intel-generation.test.ts`; Jev verification remains separate.

## Person pages

Run `npx vitest run tests/people.test.ts tests/people-routes.test.ts`. Coverage includes name normalization, likely duplicate ranking, follow-up attribution by cited speaker identity (including first-name subjects and translated copies), stable to-do keys, relationship cadence, time together per month, colleague ranking, talk share, profile transcript selection, uncited claim removal and expertise downgrades, route authentication, manageable meeting checks, merge validation and Undo, to-do status changes, skipped profiles for colleagues, and provider failure messages that do not leak details.

Replay all migrations into a disposable local PostgreSQL database, set `PERSON_TEST_DATABASE_URL` to it and run `npx vitest run tests/person-pages-database.integration.test.ts`. Remote hosts are rejected and fixtures roll back. It runs the functions as `tape_authenticated` and checks: opening a speaker or participant without bumping the meeting attribution revision, reuse by confirmed email or unique full name, edit-rights gates, merge permission (admin, or edit rights in every affected meeting; never external guests), merge moves and audit rows, exact Undo, automatic attribution of new speakers by remembered full names and emails, no attribution from ambiguous or lone first names or across workspaces, team-shared profiles hidden from external guests, and team-wide to-do status that colleagues can change without opening the meeting while guests and other workspaces cannot.

Run `node tests/fixtures/person-pages/serve.mjs` and open `http://127.0.0.1:8782/` to review the real components with fictional data. Variants: `?profile=slow`, `?profile=error`, `?profile=empty&empty=1`, `?view=transcript`. Click a to-do's circle to cycle its status. The fixture does not exercise authenticated persistence, the live model, or production data.
