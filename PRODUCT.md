# Tape Product

Web sign in lasts 180 days from login and survives deployments with the same database, public origin, and signing secret. Signing out revokes the current session. Existing valid Neon sessions migrate after server verification, preserving user identity. Browser dashboard failures preserve the session and offer Retry. Meeting links return to the requested meeting after authentication. Sharing accepts any valid email, including people who have never signed in; suggestions combine connected organizations and prior recipients. Desktop device sessions also last 180 days from login, using a separate device credential that persists across deployments. Desktop launch and browser callbacks open the recorder window. Desktop status checks run during permission setup and distinguish expired sessions from connection failures.

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
13. Write private personal notes on any accessible meeting before, during, or after recording. Each reader has their own note; sharing a meeting does not share these notes. Notes store Markdown, with Write and Preview controls for headings, emphasis, lists, links, code, and tables. Pasted HTML tables and tab separated spreadsheet rows convert to Markdown.

14. Generate a compact AI followup for a completed meeting: explicit next actions in To do list, offers or needs in Dynamic without repeating tasks, and up to five unresolved questions in Potential research. Use names instead of pronouns for actions, preserve team ownership, and link every item to transcript evidence. Clicking a research paragraph copies its question, necessary meeting context, attributed excerpts and suggested evidence to collect as a standalone AI research prompt. Confirm successful copying with a toast and report clipboard failures truthfully. Generate one shared result for the current source; readers can view and copy it in their personal default language. Translations preserve items, names and citations. Legacy summaries without research remain available. Potential connections includes people, organizations, teams and projects grouped by the speaker who described the relationship. Distinguish knowing, working with, meeting, introductions, discussions, reviews, investments and mentions; preserve missing identity fields and exact transcript evidence. Do not infer willingness to introduce or personal contact from a project mention. Connection groups follow speaker corrections, including single segment corrections and failed save rollback. Connection fingerprints ignore speaker labels but still invalidate changed content, timestamps, titles or visible meeting composition. Older summaries remain readable until regenerated; other followup sections retain their source invalidation rules.

Show identified internal speakers after external or unknown speakers. Determine organization membership from an unambiguous participant email and configured domains, never a first name. Mutual is a user confirmation of an established relationship on both sides; generated output cannot confirm it. Managers can correct identity, description, relationship, mutual status and speaker attribution independently of the transcript. Preserve corrections across reloads, speaker renames and regeneration for unchanged source content. Reject concurrent overwrites and keep failed drafts available.

Personal notes accept `@now` followed by Space to capture a moment, or explicit `[mm:ss]` and `[hh:mm:ss]` playback times. A pending Moment stores its source meeting and capture instant until recording timing covers that instant; missing timing and recording gaps are never converted to guessed offsets. Clicking a resolved time focuses the transcript and plays available audio.

A single uploaded recording stays local during preview. Filename date suggestions disclose assumed years and timezone; modification and embedded creation dates are clues that may reflect copying or export. The user edits the time and explicitly selects a nearby synced calendar meeting or creates a new meeting. Occupied or busy calendar meetings cannot receive this import. The existing Replace audio action remains separate. Multiple audio imports retain their existing playback order and new meeting flow.

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

The macOS recorder starts immediately for the displayed current or next calendar event. Automatic suggestions and missed bot alerts use personal meeting ownership or active calendar participant access with recording rights; workspace admin visibility alone does not qualify a meeting. Its title becomes a selector during capture, allowing the user to choose any writable meeting in the paired workspace or create a new meeting. Choosing a recent meeting resumes its record as another media segment, preserving prior audio and transcript. A confirmed destination stays attached to the capture until another selection is confirmed; stopping waits for an in flight destination change and freezes the destination and allows a new capture while the previous upload finishes.

The selector explains that changing the meeting applies to the entire current recording. It shows the event time or a clearly labelled creation date, transcript state, and unavailable recording destinations. A definite rejected selection keeps the confirmed destination; an uncertain network response requires confirmation. When the displayed event already has a recording bot, the primary action explicitly creates a separate meeting. A missing recording API is a service availability failure, not a meeting conflict; the failure remains visible after calendar refresh and offers Retry recording. Stopped recordings retain named upload receipts and Open meeting links. Unresolved uploads and failures remain reachable ahead of completed receipts. Account changes clear these display details without discarding durable capture recovery.

Missing bot notifications offer an explicit Start recording action. Dismissing one does not record. The recorder asks whether the meeting ended when its captured call window closes, after 60 seconds of continuous silence beyond a scheduled end, or after 5 minutes of continuous silence for a meeting without an end time. Both audio sources must provide fresh quiet samples. End recording stops capture; Keep recording dismisses the prompt and snoozes reminders. If meeting capture already ended, Keep recording starts a new local segment for the same meeting. Silence alone never ends a recording.

Continue recording joins a new Zoom or Google Meet link under the existing meeting for strictly less than one hour after the actual last recording end. The scheduled calendar end does not extend this window. The prior bot name is reused, with no personal name or email input. New meetings use organization bot settings.

Merge meetings adds an existing meeting even while transcription is pending. Up to 20 sources can be added; nested combinations are not supported. Candidates must have the same workspace, owner, organization visibility, and active recipient roles. Sources retain their records, processing jobs, media, private notes, and access controls. Undo removes a merge relationship and restores the source in the library. Continuation sources stay part of their meeting.

Combined transcript sections remain useful while another source is processing. Note questions and exports include available readable parts; combined followups wait for all visible sources to finish. Sharing the destination alone does not share the sources. Replace audio is available on individual recordings, including original source pages.

Speaker correction supports email first or name first selection. A selected contact stays linked while its display name is edited. Intentional whole speaker name edits default to updating that contact's workspace preferred name; single line corrections require a separate choice to rename globally. Change person and Unlink retain the historical transcript label. Name only local corrections and contacts without email remain available.

Workspace people have permanent IDs and may have several explicitly associated meeting emails. The same mailbox may belong to several contacts; selecting an email never silently merges them. Email association confirms a user's choice, not mailbox ownership or meeting access. Existing transcripts receive stable groups without automatic person assignments. Only a meeting owner or workspace administrator who is an actual workspace member can manage these identities. Shared readers see permitted speaker labels without the contact directory or email metadata.

## Recording reliability

Started meetings remain visible while recording or processing is unresolved, including when provider notifications are delayed. A background check reconciles Recall bot state every five minutes for the past 30 days and repairs missing transcription dispatches. Already running, completed, or failed transcription jobs are not automatically submitted again.

## Intel

Intel is a search workspace at `/intel`. History occupies the left sidebar. The main search bar accepts an intel selection, a confirmed person selection, pasted text, or a public HTTPS URL. Intel can be sorted by importance or recency; People can be filtered by name or meeting context. Intel and pasted content return potential interested recipients, excluding an intel item's source speaker. People return relevant intel and useful contacts. Results can be selected to continue in either direction.

Extraction distinguishes reported facts, anecdotes, plans, opinions, AI insights and numbers. It runs after transcript enrichment and through an hourly repair queue. It is not rendered on the meeting page. Source references are checked deterministically; a separate model pass audits semantic support before storing or displaying claims. This is not a guarantee of factual truth or calibrated interest probability.

Matching uses personally accessible meetings in the active workspace, current transcript generations, initial and latest available meetings, and the past six months of transcripts, valid Dynamics and Connections. Confirmed workspace person IDs unify speaker histories; migrated unlinked groups remain separate even when they share a name or email label. Mentioned contacts do not merge automatically. A user can explicitly combine meeting identities when selecting a person. Mentioned contacts retain their attributed relationship and source. Saved queries rerun authorization rather than replaying stored results.

Native fallback capture requires a selected meeting window and retains sampled screenshots of meaningful content changes. Audio is recorded as mono AAC with microphone voice processing. Saved audio and screenshots resume interrupted uploads from completed parts. The current implementation and release verification boundary are documented in [recorder upload recovery](docs/recorder-upload-recovery.md).
