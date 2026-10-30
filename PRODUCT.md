# Tape Product

Browser dashboard failures preserve the session and offer Retry. Meeting links return to the requested meeting after authentication. Sharing accepts any valid email, including people who have never signed in; suggestions combine connected organizations and prior recipients. Desktop launch and browser callbacks open the recorder window. Desktop status checks run during permission setup and distinguish expired sessions from connection failures.

## Users

Internal investors and team operators who need to capture, review, search, share, correct, and follow up on meetings quickly. They should not need technical knowledge of capture, transcription, storage, or background processing systems.

Tape supports three access modes:

1. Workspace members can create and review meetings.
2. Team administrators can manage workspace identity, sharing defaults, bot identity, and transcription vocabulary.
3. Shared only users can read meetings explicitly shared with them but cannot create or manage meetings.

## Product Purpose

Turn meetings into dependable team memory. Success means colleagues can understand meeting status, find the right conversation, review the original record, correct it, share it safely, and recover failed capture without learning the underlying systems.

Calendar resync keeps recent event capture in the foreground and checks Google Calendar events, including events never imported, with no meeting record from the past 30 days in the background. Current Google details determine eligibility. Past meetings with a supported conferencing link, location, or at least two distinct participant emails become missed records; deleted events, all day events, excluded invitations, and events without any of these meeting details are skipped. Existing meeting recordings and statuses are preserved.

## Current Workflows

1. Add a Google Meet or Zoom link and send the meeting bot.
2. Connect Google Calendar for automatic Google Meet and Zoom capture and repair, while Microsoft Teams meetings stay visible and prompt local recording.

   Timed invitations with at least two distinct participant emails also create local recording meetings when both the meeting link and location are missing.
   Events with a physical location are classified as in person even when they include a meeting link. They use location reminders instead of scheduled meeting bots. A conference URL or a virtual location label such as “Online” does not count as a physical location.

   Flight itineraries titled like “Flight to Newark (UA 274)” and reservations
   titled like “Reservation at Blue Blossom” are excluded from calendar meeting
   creation. Previously imported scheduled or missed in person itineraries and
   reservations are hidden from the meeting library; recorded meetings remain visible.
3. Upload audio or video by choosing files or dragging them into the recording upload area, paste a transcript, or record on a phone. Multiple audio files keep their selection order.
4. Use the macOS recorder for in-person meetings, ad hoc calls, and any meeting cloud capture misses.
5. Search the meeting library by title, participant, entity, or transcript text.
6. Query the archive or upload a local audio meeting at a chosen time from an outside assistant over the MCP server, scoped to the caller's access and meeting creation rights.
7. Review synchronized audio, transcript, speakers, translation, and captured screen share images.
8. Export transcript text, audio, and meeting images.
9. Share a transcript with workspace members or named external colleagues, optionally including past and future meetings in the same related series. When a transcript finishes, the meeting is also shared automatically with the workspace members the bot heard speak, recognized by the email the meeting platform reports or by a name that matches exactly one member or remembered speaker. This covers instant meetings that have no calendar invitees; external participants are never shared automatically.
10. Review remaining workspace credit and personal or organization provider consumption across useful time periods from Team settings.
11. Start a personal workspace with any Google account and use up to $5 of included provider credit.

12. With email delivery configured, receive AI generated notes and the complete original transcript as separate TXT attachments at the meeting owner's login email after recording transcription finishes. Batched recordings produce one email after every part completes. Translation requests do not send email.
13. Write private personal notes on any accessible meeting before, during, or after recording. Each reader has their own note; sharing a meeting does not share these notes.

14. Generate a compact AI followup for a completed meeting: explicit next actions in To do list, offers or needs in Dynamic, and up to five unresolved questions in Potential research. Use names instead of pronouns for actions, preserve team ownership, and link every item to transcript evidence. Clicking a research paragraph copies its question, necessary meeting context, attributed excerpts and suggested evidence to collect as a standalone AI research prompt. Confirm successful copying with a toast and report clipboard failures truthfully. Meeting managers generate or regenerate; existing readers can view and copy saved results. Older summaries remain available until regenerated. Source changes invalidate old results.

Questions in personal notes are answered inline from the current meeting transcript after a typing pause. Keep multiple question and answer pairs together, allow direct answer editing with autosave, preserve user corrections, and distinguish missing information from stated facts. Generated answers remain private alongside the note.

## Brand Personality

Calm, direct, trustworthy. The interface should feel like a focused internal tool that handles complexity for the user.

## Anti-references

Dense administration panels, exposed implementation identifiers, decorative analytics, repeated explanatory copy, generated intelligence presented as source truth, and interfaces that look healthy when backend work has failed.

## Design Principles

1. Put the common task first and reveal uncommon choices only when needed.
2. Group related actions into one clear workflow.
3. Use plain language and visible outcomes instead of technical metadata.
4. Let automation provide sensible defaults before asking the user to decide.
5. Make failures explicit and actionable.
6. Keep the transcript and captured media as the meeting record.
7. Enforce workspace and shared access consistently across web, exports, media, and MCP.

## Success Criteria

1. A colleague can find and open the right meeting quickly.
2. Meeting status matches the actual capture and transcription state.
3. Missing content leads to one clear recovery action.
4. Search, sharing, correction, and export work without exposing provider details.
5. Shared only users see only explicitly granted content and no owner actions.
6. Automated tests cover the web app, browser flows, macOS recorder, sidecar, and MCP server.
7. Cost summaries separate exact provider charges from published rate estimates without exposing another member's meeting details.
8. Public accounts receive isolated personal workspaces, while IOSG team members and other configured organization domains keep their shared workspace and unlimited credit.

## Not Product Goals

Tape is not a provider administration console, a general analytics dashboard, or a replacement for the original meeting record with unverified generated notes.

Meeting managers can replace an incorrect recording on a completed meeting through Replace audio in the meeting actions menu. The replacement stays on the same meeting, preserves its title and sharing, and queues a new transcript. Previous stored assets are retained; this is not a permanent media purge.

## Accessibility and Inclusion

Maintain keyboard access, visible focus states, semantic labels, sufficient contrast, and reduced motion compatibility. Do not rely on color alone to communicate state.

A person can connect multiple Google Calendar accounts without replacing other accounts. Verified work emails join configured organization workspaces as members. Company domains may share one workspace and one scheduled bot per meeting, while keeping domain specific bot names and avatars. Administrators edit only organizations they administer and may select the preferred bot for meetings involving multiple company domains.

## Organization context

A connected calendar account, company workspace, and bot identity are separate choices. Multiple accounts do not imply multiple bots. New bot requests require an explicit choice when multiple organization identities are available. Calendar automation retains the company preference for shared meetings. Other creation flows use the selected workspace; existing meeting actions retain the meeting’s workspace and access rules. Desktop pairing and MCP uploads ask for an organization when membership is ambiguous.

## Meeting continuity

The macOS recorder starts immediately for the displayed current or next calendar event. Its title becomes a selector during capture, allowing the user to choose any writable meeting in the paired workspace or create a new meeting. Choosing a recent meeting resumes its record as another media segment, preserving prior audio and transcript. A confirmed destination stays attached to the capture until another selection is confirmed; stopping freezes the destination and allows a new capture while the previous upload finishes.

Missing bot notifications offer an explicit Start recording action. Dismissing one does not record. The recorder asks whether the meeting ended when its captured call window closes, after 60 seconds of continuous silence beyond a scheduled end, or after 5 minutes of continuous silence for a meeting without an end time. Both audio sources must provide fresh quiet samples. End recording stops capture; Keep recording dismisses the prompt and snoozes reminders. If meeting capture already ended, Keep recording starts a new local segment for the same meeting. Silence alone never ends a recording.

Continue recording joins a new Zoom or Google Meet link under the existing meeting for strictly less than one hour after the actual last recording end. The scheduled calendar end does not extend this window. The prior bot name is reused, with no personal name or email input. New meetings use organization bot settings.

Merge meetings adds an existing meeting even while transcription is pending. Up to 20 sources can be added; nested combinations are not supported. Candidates must have the same workspace, owner, organization visibility, and active recipient roles. Sources retain their records, processing jobs, media, private notes, and access controls. Undo removes a merge relationship and restores the source in the library. Continuation sources stay part of their meeting.

Combined transcript sections remain useful while another source is processing. Note questions and exports include available readable parts; combined followups wait for all visible sources to finish. Sharing the destination alone does not share the sources. Replace audio is available on individual recordings, including original source pages.

Remembering a speaker name is an explicit option during an all matching lines correction. It stores the complete verified email within the workspace. Names alone, generic speaker labels, and single line corrections do not train future identity matching.

## Recording reliability

Started meetings remain visible while recording or processing is unresolved, including when provider notifications are delayed. A background check reconciles Recall bot state every five minutes for the past 30 days and repairs missing transcription dispatches. Already running, completed, or failed transcription jobs are not automatically submitted again.
