# Note moments and recording import

October 30, 2026. Approved October 31 with `@now` replacing the originally proposed slash command. Implementation and Astra product, rendered UI, and final code reviews are complete. The final scoped review scored 91/100 with no remaining material finding. Verification evidence and production limitations are recorded in the implementation plan.

## User outcome

During a meeting, capture a moment without leaving personal notes. After the meeting, reopen the same note and select its timestamp to find the corresponding transcript and audio. When importing a recording, preview it and deliberately choose the correct calendar meeting or create a new meeting.

## Recommended approach

Extend the existing personal note editor and upload form. Keep the current typography, warm light surfaces, private note permissions, autosave, draft recovery, and conflict handling.

The alternatives are a separate bookmark panel or a full rich text editor replacement. The panel separates a moment from its note; an editor replacement expands scope and risks established autosave behavior. Neither is necessary for these features.

## Note example and interaction

Typing `@now ` at the caret inserts a captured timestamp, for example `[12:34]`. The user continues with `Confirm renewal budget`. A small timestamp action provides the same behavior without memorizing grammar. Typing `[12:34]` or `[1:02:34]` explicitly targets a known position.

The saved presentation shows a compact clickable time beside the note. Editing remains available without duplicating the entire note. Time actions have descriptive accessible names, visible keyboard focus, and comfortable touch targets. Grammar conversion only affects a newly entered command at the caret; pasted content and active IME composition remain intact.

Capture time comes from actual recording timing or the current playback position. A scheduled calendar start is not a recording clock. Without reliable live timing, the action saves a source scoped capture instant and shows a pending Moment. It resolves only if actual recording timing later covers that instant; explicit timestamps remain usable. Stopping a recording does not move existing markers.

Live markers retain recording identity and a local offset, or an equivalent stable capture anchor, so a resumed recording with a gap can be resolved to the final playback timeline. Explicit timestamps refer to the displayed playback timeline. Avoid silently treating a wall clock offset as a concatenated audio offset. Persist marker information through edits, question block splitting, answer removal, copying, conflicts, and reloads.

Selecting a marker targets only its owning meeting or recording. Reveal and highlight the nearest transcript segment and seek available audio. Transcript navigation remains useful when audio is missing. When transcription is pending, retain the note and explain that the transcript is not ready. Composed meetings must not make every transcript player respond to one click.

## Recording import example and interaction

The user selects `Oct 19 at 11-41 AM.m4a`. Show a single review surface in this order:

1. Filename, duration, and a local media preview with play, pause, scrub, elapsed time, and a labeled Jump to field accepting `mm:ss` and `hh:mm:ss`.
2. Visible editable recording date, time, and timezone, with the origin of the suggestion.
3. Nearby calendar meetings as explicit choices, plus Create a new meeting with an editable title.
4. A submit action that names the chosen destination. After successful queueing, open that meeting detail page.

No recording upload begins before submission. Replacing the file stops playback, revokes the previous object URL, clears old destination selection, and invalidates pending metadata and calendar requests. Preview codec failure does not reject a format the upload service supports. Invalid or out of range jumps show a useful error without submitting the upload form.

For the supplied sample, local ffprobe inspection found:

1. Duration: 5,127.9 seconds, approximately 1 hour 25 minutes 28 seconds.
2. Filename: October 19 at 11:41 AM, without a year or timezone.
3. Embedded creation time: `2026-10-19T20:11:23Z`.
4. File modification date: October 30, 2026.

These are conflicting clues. Embedded creation time may represent finalization or export and must not be presented as a proven recording start. Filename inference must label assumed year and timezone. File modification is a weak fallback. A location style filename provides no date evidence by itself. The user can correct the time before calendar matching and submission.

## Calendar association and existing recordings

Find permitted calendar meetings near the edited recording interval, rank overlap and start proximity, and show title, date, local time, and existing recording state. Never silently attach a suggested match. Distinguish loading, no nearby matches, and calendar lookup failure. Allow date correction and retry without losing the file or preview position. Cancel stale requests and ignore responses for an older file, time, or workspace.

An existing meeting that already has a recording must not silently lose its transcript. The current recovery upload path uses replacement semantics. The implemented import chooser only attaches to an empty, inactive calendar meeting. Existing recordings are disabled with an Open meeting link; replacement remains in the existing meeting action. A new meeting remains available. Busy recording targets must be unavailable with an explanation.

Both direct storage upload and server fallback must preserve the same selected meeting, recording time, duration, and title. Check write permission and current target state on the server at completion, not only when listing candidates. Preserve workspace boundaries. Failed requests retain the file and selection for recovery; retries must not create duplicate associations.

The existing multiple audio file workflow must remain functional and keep playback order. Date inference must not silently overwrite the historical start with the upload time.

## Evidence from product references

[Granola writing notes](https://docs.granola.ai/help-center/taking-notes/taking-notes-in-granola) documents a focused note canvas with basic Markdown. [Granola calendar sync](https://docs.granola.ai/help-center/getting-started/syncing-your-calendars) documents event context and a compact list with more events available through navigation.

[Otter conversation overview](https://help.otter.ai/hc/en-us/articles/5093228433687-Conversation-Page-Overview) documents transcript navigation from generated action items, audio playback, and highlights. Its article distinguishes automatically linked action items from manually added items. These references support focused writing and discoverable source navigation; they do not establish that either product implements the proposed `@now` grammar or recording filename matching.

Official documentation was opened directly, then searched through the configured direct Exa MCP endpoint on October 31. Granola documentation explicitly states it does not support recording uploads or retain audio; the import workflow is a Tape feature, not a Granola parity claim. No competitor parity claim has been verified.

## Implementation boundaries

Primary files are `components/meeting-notes.tsx`, `components/use-meeting-note.ts`, `lib/meeting-note-document.ts`, `components/transcript-viewer.tsx`, `components/meeting-composed-transcripts.tsx`, `app/meetings/[meetingId]/page.tsx`, and `components/upload-dropzone.tsx`. Extract focused timing, filename inference, preview, and destination selection helpers where needed.

Review `lib/meeting-recording-timeline.ts`, `lib/meeting-audio-batches.ts`, and existing upload routes before choosing storage and attachment changes. The current upload redirect always returns the dashboard for a single file; replace it with a validated meeting detail destination. The current strict note schema and block reconstruction paths require care if adding structured timestamp metadata.

## Verification and review

Baseline before changes: 51 tests passed across `tests/meeting-notes-interactions.test.tsx`, `tests/upload-dropzone.test.tsx`, and `tests/meeting-page.test.tsx`.

Required checks include save then reload, stop then reload, resumed recording with a gap, composed viewers, missing transcript or audio, concurrent note edits, IME and paste, filename parsing, absent year, timezone and DST handling, conflicting metadata, stale calendar responses, denied target access, busy targets, existing recordings, direct and fallback upload, retry, long recording jumps, invalid codec, keyboard use, and 320 px and 390 px layouts. Use the supplied recording for local preview verification without uploading it as part of development.

Astra reviews the implemented product flow, rendered desktop and mobile UI, and final code changes. The scoped rubric is timestamp correctness and persistence 25 points, date inference and association 25, navigation and preview 20, accessibility and clarity 15, and recovery and concurrency 15. Target at least 90 out of 100 with no critical failure involving wrong association, note loss, fabricated timing, workspace leakage, or upload before submission. This is a review rubric, not measured percentage parity with a competitor.

Update current product, design, setup, testing, and relevant interface documentation only for verified behavior. Do not describe fixtures, mocked API tests, or local rendering as deployed validation.
