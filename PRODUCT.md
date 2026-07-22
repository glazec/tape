# Tape Product

## Users

Internal investors and team operators who need to capture, review, search, share, correct, and follow up on meetings quickly. They should not need technical knowledge of capture, transcription, storage, or background processing systems.

Tape supports three access modes:

1. Workspace members can create and review meetings.
2. Team administrators can manage workspace identity, sharing defaults, bot identity, and transcription vocabulary.
3. Shared only users can read meetings explicitly shared with them but cannot create or manage meetings.

## Product Purpose

Turn meetings into dependable team memory. Success means colleagues can understand meeting status, find the right conversation, review the original record, correct it, share it safely, and recover failed capture without learning the underlying systems.

## Current Workflows

1. Add a Google Meet or Zoom link and send the meeting bot.
2. Connect Google Calendar for automatic capture and repair.
3. Upload audio or video, paste a transcript, or record on a phone.
4. Use the macOS recorder when cloud capture misses a meeting.
5. Search the meeting library by title, participant, entity, or transcript text.
6. Review synchronized audio, transcript, speakers, translation, and captured screen share images.
7. Export transcript text, audio, and meeting images.
8. Share a transcript with workspace members or named external colleagues.

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

## Not Product Goals

Tape is not a provider administration console, a general analytics dashboard, or a replacement for the original meeting record with unverified generated notes.

## Accessibility and Inclusion

Maintain keyboard access, visible focus states, semantic labels, sufficient contrast, and reduced motion compatibility. Do not rely on color alone to communicate state.
