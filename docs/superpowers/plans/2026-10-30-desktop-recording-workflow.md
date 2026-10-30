# Desktop recording workflow implementation plan

> Execute with superpowers:subagent-driven-development. The user's six requirements in chat are the approved design. Work in the existing codex/desktop-ux-release worktree.

**Goal:** Start capture immediately for the displayed event, allow changing its destination without restarting capture, support resuming a recent meeting, and offer actionable start and end prompts.

**Architecture:** Keep capture and recording destination separate. Use an authenticated server operation to create or reassign an active local recording attempt. Preserve the intent token while changing its destination so native uploads and Recall SDK completion resolve to the selected meeting. Expose a searchable, authorized meeting list. Preserve previous recordings and append transcripts on resumed meetings. Keep a single event stream from the SDK sidecar for both recording acknowledgements and meeting end detection.

**Tech stack:** Next.js route handlers, Drizzle/PostgreSQL, Vitest, SwiftUI/AppKit, Swift Testing, Recall Desktop SDK sidecar.

## Acceptance criteria

1. Settings always uses the gear icon. It toggles the section below, defaults collapsed, and collapses on recording start.
2. Idle summary selects a current or next event, excluding stale events with missing end dates. Record starts against the displayed event. Once recording, the title opens a searchable meeting selector with New meeting. Selection does not restart capture or lose elapsed audio. Failed selection retains the original destination.
3. Zoom and Google Meet SDK capture, desktop audio fallback, local upload retry and existing bot automation remain intact.
4. Recent meetings can receive additional recording segments without replacing earlier media or transcripts.
5. A bot that has not joined a linked meeting after the existing grace period triggers an actionable notification. Clicking starts recording for that exact meeting. Dismissal does not record, and active recording suppresses duplicate start prompts.
6. Scheduled recording: ask whether to stop after one continuous minute of silence beyond its scheduled end. No silence prompt before that end. Ad hoc recording: ask after five minutes of silence. A detected meeting ending also offers a stop prompt. Never stop without user action. Keep recording snoozes repeated prompts. Combine microphone and system audio so an idle mic cannot override active call audio.

## Task 1: Backend destination selection and resume

Files: lib/local-recorder-records.ts, lib/local-recorder-policy.ts as needed, app/api/local-recorder/recording-meetings/route.ts, app/api/local-recorder/recording-target/route.ts, relevant recording completion code, tests/local-recorder-records.test.ts and route tests.

Add authenticated GET /api/local-recorder/recording-meetings?q=... returning { meetings: [{ meetingId, title, startsAt, endsAt, status }], hasMore }. List recent and upcoming first; search covers older authorized events. Avoid allowing shared read access to grant write permission.

Add POST /api/local-recorder/recording-target with { fallbackIntentId?, meetingId?, title? }. With no token, create an attempt for the chosen event or a new meeting. With a token, reassign that same active attempt. Return { fallbackIntentId, meetingId, meetingTitle, startsAt, endsAt }. Reject another device/user's token, cancelled/inaccessible meetings, completed attempts and competing active capture. Preserve bot state and existing assets. Use transactional or atomic SQL for coupled changes. Ensure SDK metadata/webhooks follow the moved attempt rather than stale meeting identifiers. Ensure transcription append behavior for both capture backends.

Add POST /api/local-recorder/recording-target/finish with { fallbackIntentId } to freeze a stopped segment as sealed. A new segment may start while this segment uploads. All older start/retry endpoints must preserve the freeze. Add authenticated POST /api/local-recorder/recording-target/status with the same body to report the attempt state. Native SDK upload processes remain alive until the server confirms completion; stopping capture is not proof that the upload finished. Only successful SDK completion handling marks the attempt completed. A late failure must not downgrade completion.

Write failing tests for target selection, unauthorized changes, races, stale schedule selection, repeated switching, resume preservation, and SDK completion. Run targeted Vitest tests before and after implementation.

## Task 2: Native recording flow and end prompts

Files: LocalRecorderCore models/client and tests; RecorderMenuView.swift; a focused RecorderMeetingPicker.swift; RecorderAppModel; RecallDesktopSDKCapture.swift; sidecar event forwarding and tests.

Use the target API to bind before capture and to move the destination during capture. Publish active meeting ID and scheduled end; preserve original state on failed switch. Disable repeated start/switch while the operation is pending. Fetch selector results when opened and on search; discard stale responses. New meeting uses an optional title. Always show the gear and collapse settings at start.

Add a pure end prompt policy with injectable times. Observe the maximum fresh microphone/system level at a timer cadence. Scheduled silence must begin no earlier than the original end, threshold 60 seconds; no end time uses 300 seconds. Ignore missing/stale meter samples rather than assuming silence. Deliver notification actions Stop and Keep recording, with an in-app fallback. Reject stale notification actions using a recording session identity.

Maintain one sidecar stdout reader; forward meeting end events for the active capture window without confusing explicit stop or SDK failure with meeting end. Preserve normal stop acknowledgement. Add explicit Start recording notification action, and never treat notification dismissal as start.

Verify with Swift tests, native build, sidecar tests and existing permission scripts. Inspect snapshot rendering where supported.

For SDK natural meeting end, offer Stop and Keep recording. Keep recording creates an additional segment for the same destination; it never discards the ended SDK segment. Explicitly stopping a segment freezes its destination before a new capture starts. Prevent normal app quit/restart/sign out while SDK uploads still need the app, and make pending uploads visible. Tests must cover event ordering and distinguish explicit stop from a detected meeting closure.

SDK lifecycle reference: [Recall event types](https://docs.recall.ai/docs/desktop-recording-sdk-event-types) and [safe shutdown](https://docs.recall.ai/docs/dsdk-safe-shutdown), checked against the installed 2.0.24 TypeScript declarations. Use meeting-closed for call closure; recording-ended is not upload confirmation.

Review followups: new starts send a persisted clientRequestId UUID to recover a lost HTTP response without creating a second attempt. Persist the exact initial destination with that ID. Store each transcript job's applied recording offset and rebase existing segment timestamps under the meeting transaction when an earlier capture arrives late. Preserve segment identity and edits, and keep replacement generation boundaries unchanged.

## Task 3: Review and documentation

Review spec compliance then code quality with separate review passes. Fix findings and rerun affected tests. Update README.md, PRODUCT.md, DESIGN.md, docs/setup.md, docs/testing.md, recorder and MCP documentation only where behavior changes. Check for same basename language/format variants before editing. Run targeted backend, Swift, sidecar, permission, lint and type checks. Report exactly what was tested, distinguish local validation from live Zoom/Meet calls and production rollout.
