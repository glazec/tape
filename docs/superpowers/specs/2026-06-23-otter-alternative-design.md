# Otter Alternative Design

> Historical record from June 23, 2026. This document describes the initial product boundary and is not the current Tape contract. Use the [product](../../../PRODUCT.md), [design guide](../../../DESIGN.md), [README](../../../README.md), and [setup guide](../../setup.md) for current behavior.

## Goal

Build a team meeting transcript product. The product records meetings, captures meeting media, transcribes audio, stores everything in cloud services, and lets internal team members search and share transcripts.

The v1 product is transcript first. AI generated meeting notes are out of scope.

## Approved Product Scope

1. Users sign in with Google OAuth.
2. Users belong to team workspaces.
3. Team workspaces define allowed internal email domains.
4. The product auto joins eligible calendar meetings.
5. The product supports manual meeting link recording.
6. The product supports MP3 upload.
7. The product transcribes recordings with ElevenLabs.
8. The web app shows meeting transcripts.
9. The web app supports basic create, read, update, delete, and search.
10. The web app supports explicit sharing.
11. Internal meeting attendees automatically get access when their email belongs to the same team workspace and allowed domain.
12. External attendees do not get automatic access.

## Platforms

v1 supports:

1. Google Meet
2. Zoom

## Architecture

The product uses vendor managed meeting capture and owns the product data model.

1. Recall.ai joins Google Meet and Zoom meetings, records meeting audio and media, supports calendar based scheduling, and sends webhook events.
2. ElevenLabs transcribes audio from meeting recordings and MP3 uploads.
3. The application stores normalized teams, users, meetings, attendees, access grants, media assets, jobs, and transcript segments.
4. Raw vendor webhook payloads can be stored for debugging, but they are not the primary product model.

## Cloud Stack

1. Next.js powers the web app and API surface.
2. Vercel hosts the web app.
3. Neon Auth handles Google OAuth for v1.
4. Neon Postgres stores product data.
5. Cloudflare R2 stores audio files, screenshots, MP3 uploads, and Recall media assets.
6. Inngest style background workers handle calendar sync, Recall scheduling, media ingest, and transcription jobs.
7. The UI uses the Vercel Geist light theme direction from `https://vercel.com/design.md`.

## Storage Boundary

Cloudflare R2 stores binary media. Neon stores metadata and permissions.

R2 objects include:

1. Uploaded MP3 files
2. Meeting recording audio
3. Screenshots or captured media frames
4. Vendor media assets downloaded from Recall

Neon records include:

1. R2 bucket name
2. R2 object key
3. MIME type
4. File size
5. Checksum when available
6. Asset source
7. Processing state
8. Meeting access rules

Do not store large media blobs in Postgres.

## Auth And Team Access

Google OAuth identifies the user. Team access is product owned.

Core rules:

1. A user signs in with Google.
2. A user belongs to one or more teams.
3. A team has allowed internal domains.
4. A meeting belongs to one team.
5. The recording initiator is the meeting owner.
6. Team admins can access team meetings.
7. Internal calendar attendees get automatic access only when their email maps to an existing team member and an allowed internal domain.
8. External attendees are stored as attendees but receive no automatic access.
9. External access requires an explicit share link.
10. Share links can expire and can be revoked.

## Meeting Ingest Flows

### Calendar Auto Join

1. A user connects Google Calendar.
2. The app syncs future events with Google Meet or Zoom links.
3. The app stores calendar event metadata and attendee emails.
4. The app schedules Recall bot attendance for eligible meetings.
5. Recall sends dashboard configured webhook updates as the bot joins, records, and finishes.
6. The app downloads or references the resulting media assets.
7. The app stores media in Cloudflare R2.
8. The app creates an ElevenLabs transcription job.
9. The completed transcript is stored as searchable transcript segments.
10. Internal attendees receive access according to the team domain rule.

### Manual Meeting Link

1. A user pastes a Google Meet or Zoom link.
2. The app creates a meeting record.
3. The app schedules a Recall bot for that link.
4. The same media ingest and transcription pipeline runs.

### MP3 Upload

1. A user uploads an MP3 file.
2. The app stores the file in Cloudflare R2.
3. The app creates a meeting record with upload source.
4. The app creates an ElevenLabs transcription job.
5. ElevenLabs sends workspace configured transcription webhooks when `webhook=true`.
6. The completed transcript is stored as searchable transcript segments.

## Web App

### Main Views

1. Sign in
2. Team setup
3. Calendar connection
4. Meeting list
5. Meeting detail
6. Manual meeting link form
7. MP3 upload form
8. Share settings
9. Team settings

### Meeting List

The meeting list supports:

1. Search by title, attendee, and transcript text
2. Filter by owner
3. Filter by date
4. Filter by platform
5. Filter by processing state
6. Filter by access

### Meeting Detail

The meeting detail page shows:

1. Meeting title
2. Time and platform
3. Attendees
4. Processing status
5. Transcript segments
6. Speaker labels when available
7. Screenshots or media assets when available
8. Share controls
9. Edit controls for title and transcript corrections

## Sharing And Retention

Default share policy:

1. Share links are disabled by default.
2. Share links expire after 14 days by default.
3. Share links can be revoked at any time.
4. Share links expose transcript access only, not team settings or raw vendor payloads.
5. Password protected share links are out of scope for v1.

Default retention policy:

1. Transcript records are retained until deleted by an authorized team member.
2. Audio and screenshot media are retained for 90 days by default.
3. Team admins can delete media earlier.
4. Deleting a meeting deletes transcript records and schedules media deletion from Cloudflare R2.

## Search

v1 search uses Neon Postgres full text search over transcript segments and meeting metadata.

The initial implementation uses expression GIN indexes with `to_tsvector('english', ...)` on meeting title and URL metadata plus transcript segment text and speaker. Query helpers pass normalized user input to `websearch_to_tsquery('english', $1)`.

This is enough for the first product because it keeps search close to permissions and avoids a separate search service. If volume grows, a dedicated search system can be added later while keeping the same meeting and transcript model.

## Data Model

Initial tables:

1. `teams`
2. `allowed_domains`
3. `users`
4. `team_memberships`
5. `oauth_accounts`
6. `calendar_connections`
7. `calendar_events`
8. `meetings`
9. `meeting_attendees`
10. `meeting_access`
11. `share_links`
12. `recordings`
13. `media_assets`
14. `transcript_jobs`
15. `transcript_segments`
16. `vendor_webhook_events`
17. `audit_events`

## Processing Rules

Every external event must be idempotent.

Idempotency is required for:

1. Calendar event sync
2. Recall bot scheduling
3. Recall dashboard configured webhooks
4. Media asset ingest
5. MP3 upload completion
6. ElevenLabs workspace configured transcription completion webhooks
7. Share link creation

This prevents duplicate meetings, duplicate transcript jobs, and duplicate access grants when vendors retry requests.

Worker execution uses an Inngest style model with durable function runs, retries, and event based orchestration.

## Error Handling

1. Calendar sync failures are visible in calendar settings.
2. Recall join failures are visible on the meeting detail page.
3. Transcription failures are visible on the meeting detail page and can be retried.
4. Upload failures do not create completed meetings.
5. R2 upload failures leave the meeting in failed media ingest state.
6. Webhook signature failures are rejected and logged.
7. Access denied responses never reveal whether a private meeting exists.

## Testing Strategy

1. Unit tests for access rules, attendee matching, share links, and idempotency keys.
2. Integration tests for Google OAuth callback handling.
3. Integration tests for calendar event sync.
4. Integration tests for Recall webhook handling using documented bot status payloads.
5. Integration tests for ElevenLabs transcription completion using documented speech to text payloads.
6. Integration tests for R2 upload and presigned URL generation.
7. End to end tests for sign in, meeting upload, transcript view, search, and sharing.

## Out Of Scope For V1

1. AI generated meeting notes
2. Action item extraction
3. Bot speech during meetings
4. Public automatic access for external attendees
5. Microsoft Teams meeting support
6. Dedicated search service
7. Self hosted meeting bot
8. Neon private preview object storage for production media

## Implementation Verification

1. Confirm the exact Recall media asset type for screenshots during implementation.
2. Confirm Neon Auth beta constraints before production launch.
