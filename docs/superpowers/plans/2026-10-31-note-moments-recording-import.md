# Note moments and recording import implementation plan

Approved design: ../specs/2026-10-30-note-moments-recording-import-design.md

Goal: durable note moments and deliberate recording association with local preview.
Architecture: extend existing note autosave and transcript viewers; isolate recording date inference and local preview from upload transport; reuse authenticated write policy for calendar candidates and enforce safe attachment at completion.
Tech stack: Next.js 16, React 19, TypeScript, Drizzle, Vitest, Playwright.
Execution: subagent implementation for notes, primary agent implementation for import, Astra independent design and code review. Existing checkout is clean apart from this specification. Work on a dedicated branch in place.

## Task 1: Note moments

Files: components/meeting-notes.tsx, components/transcript-viewer.tsx, components/meeting-composed-transcripts.tsx, app/meetings/[meetingId]/page.tsx, lib/meeting-note-document.ts; focused new moment helper and tests.

1. Add failing interaction tests for typed @now, explicit [12:34], unavailable recording clock, save and reload, and scoped transcript navigation. Run npx vitest run tests/note-moments-interactions.test.tsx.
2. Preserve stable recording timing through autosave. Convert only a typed command at the caret; keep IME and pasted text unchanged. Make timestamps keyboard accessible and use existing visual tokens. Scope viewer navigation separately from permission to edit speakers.
3. Verify capture anchors against actual recording state, including pause or stop and multiple parts. Test helper conversion independently. Run existing note and meeting page tests with the new tests.

## Task 2: Recording import

Files: components/upload-dropzone.tsx; new recording preview and destination components; lib/recording-file-time.ts; new authenticated candidate route and server helper; existing completion and fallback upload routes.

1. Add failing tests for the supplied filename, numeric recorder names, weak file dates, invalid dates, timezone conversion, metadata conflicts, local seeking, explicit destination choice, stale response cancellation, and selected destination in direct and fallback completion.
2. Parse bounded metadata locally, suggest filename dates with an explicit source and assumptions, and retain user edits. Render local playback with native controls and a jump field. Only request calendar metadata before submit.
3. List nearby accessible calendar meetings and expose disabled reasons for occupied or busy records. Attach only to an empty permitted meeting with server concurrency protection; existing recordings stay safe. Support new meeting title and destination detail redirect. Keep existing audio batch behavior.
4. Run npx vitest run tests/recording-file-time.test.ts tests/recording-import.test.tsx tests/upload-dropzone.test.tsx tests/upload-complete-route.test.ts tests/upload-audio-route.test.ts and new candidate and attachment tests.

## Task 3: Verify and review

1. Run targeted lint and TypeScript, then relevant regressions. Fix findings rather than broad unrelated cleanup.
2. Render real components in local fixture UI. Inspect desktop, 390 px and 320 px. Exercise sample audio preview locally. Keep the sample outside source control and do not upload it.
3. Ask Astra for spec review, rendered UI review, then final code review. Address material findings and document the scope and limits of a 90/100 rubric score.
4. Update current product and testing documentation for verified behavior, inspect git diff, and report implementation, checks, and remaining live verification limits. Do not claim deployment.

## Verification results

Implementation and Astra review are complete on `codex/note-moments-recording-import`. The full Vitest run with four workers passed 2,143 tests across 274 files, with 52 tests skipped. The separate disposable PostgreSQL run passed 44 tests covering recording imports, recorder targets, and timeline behavior. The final recording import interaction run passed all seven tests, including stale calendar responses. Repository ESLint, TypeScript, and the optimized Next.js production build passed.

The real component browser fixture played the supplied 5,127.9 second file, sought to 1:02:34, advanced playback, verified transcript focus and fixture save/reload, and checked 1440 px, 390 px, and 320 px layouts without console errors. The sample remains outside source control and was not uploaded.

Astra's final scoped product, UI, and code review scored 91/100 with no remaining material finding: timestamp correctness 23/25, time inference and association 24/25, navigation and preview 18/20, accessibility and clarity 13/15, and recovery and concurrency 13/15. This is a local feature rubric, not measured competitor parity. Authenticated production upload, provider transcription, and deployed persistence remain unverified.
