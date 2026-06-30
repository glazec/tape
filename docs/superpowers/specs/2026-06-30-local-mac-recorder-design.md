# Local Mac Recorder Design

## Goal

Build a macOS fallback recorder for [meeting-note](/Users/glaze/developer/meeting-note) so a meeting can still be captured when the [Recall.ai](https://www.recall.ai/) bot does not join.

The user experience stays colleague first. The website shows one meeting, one transcript, one summary, one export, and one share surface. The local recorder is a capture fallback for the same meeting, not a separate upload product.

## Approved Scope

1. The first version targets macOS 15 plus.
2. The Mac app asks the user to sign in before monitoring meetings.
3. After login, the Mac app asks for microphone, screen audio capture, notifications, and start at login permission.
4. After recording and notification permissions are ready, the Mac app runs as a small menu bar app. Start at login is requested by default but does not block the current session if the user declines.
5. The Mac app checks the web app for eligible missed bot meetings.
6. If a meeting with a link is one minute past start time and has no successful Recall recording evidence, the Mac app shows a local macOS notification.
7. Clicking the notification claims the local fallback intent and starts recording immediately when the primary claim succeeds.
8. The recorder captures two local tracks, one for computer audio and one for the user's microphone.
9. When the user stops recording, the app uploads both tracks automatically.
10. The server attaches the local recording to the same meeting by matching the recording time to eligible missed meetings, then confirming the match with an opaque fallback intent.
11. The server creates one synthesized audio file from both tracks.
12. Export returns the synthesized audio file, not the separate technical tracks.

## Out Of Scope

1. Auto joining Google Meet or Zoom from the Mac app.
2. Recording before a user clicks the local notification.
3. Separate uploaded meetings for local recordings.
4. Showing two separate audio tracks in normal website UI.
5. Supporting macOS versions below 15 in the first version.
6. Replacing Recall as the normal meeting recorder.

## Current Product Anchors

The existing product already has the needed cloud concepts.

1. Recall webhook handling can mark a meeting as missed when a bot call ends without recording evidence.
2. Meeting rows already preserve calendar title, meeting time, meeting link, team, owner, and status.
3. Uploaded audio already stores media in [Cloudflare R2](https://developers.cloudflare.com/r2/) and creates transcription work.
4. The current upload path accepts one MP3 and creates a separate uploaded meeting. The local recorder must use a new same meeting path instead.
5. Export must prefer the synthesized local recording for locally recorded meetings.

## Mac App Architecture

The Mac app is a signed SwiftUI menu bar app.

1. `AuthController` starts web login through the hosted web app and stores the device session in [Apple Keychain](https://developer.apple.com/documentation/security/keychain_services).
2. `PermissionController` checks and requests microphone, screen audio capture, notifications, and start at login permission.
3. `MeetingMonitor` polls the server while the app is active and logged in. It can poll every minute normally, then increase to every 30 seconds when an upcoming meeting is within five minutes of the fallback window.
4. `NotificationController` shows local macOS notifications for eligible missed bot meetings.
5. `Recorder` starts only after notification click and writes two local audio files.
6. `UploadQueue` uploads completed recordings and retries failed uploads.
7. `MenuBarStatus` shows login state, permission state, monitoring state, recording state, and upload retry state.

The app uses [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit/) for system audio capture and [AVAudioEngine](https://developer.apple.com/documentation/avfaudio/avaudioengine) for microphone capture. Notifications use [UserNotifications](https://developer.apple.com/documentation/usernotifications). Start at login uses [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice).

## Login And Permissions

First run flow:

1. User opens the Mac app.
2. App asks the user to sign in.
3. Login opens the web app auth flow.
4. App stores the returned device session in Keychain.
5. App asks for microphone access.
6. App asks for screen and system audio capture access.
7. App asks for notification permission.
8. App asks for start at login permission.
9. App starts monitoring only after required recording and notification permissions are ready.

If a required recording or notification permission is denied, the app shows the missing permission and a direct action to open the relevant system setting. It does not show monitoring as active. If start at login is denied, the app still monitors for the current session and shows a degraded setup state.

## Missed Bot Detection

The web app exposes an authenticated endpoint for the Mac app:

`GET /api/local-recorder/missed-meetings`

The endpoint returns meetings visible to the signed in user's workspace where:

1. The meeting has a Google Meet or Zoom link.
2. The server clock is at least 70 seconds past the meeting start time. This gives a small grace period around the one minute product rule.
3. The meeting is still inside its expected recording window. Use `endedAt` plus 15 minutes when available, otherwise use start time plus two hours.
4. Recall has no recording id and no audio media asset for the meeting.
5. The latest Recall evidence does not show successful join or recording. Positive evidence includes `in_call`, `joined`, `recording`, `recording_done`, or an audio asset.
6. The latest Recall evidence is missing, still scheduled, in waiting room past the grace period, or terminally failed. Terminal failure includes `fatal`, `call_ended`, `timeout_exceeded_waiting_room`, `call_ended_by_host`, and equivalent failed bot states.
7. The meeting status is `scheduled`, `missed`, or `failed`. `processing` is eligible only when there is no Recall recording id, no Recall audio asset, and no active transcript job.
8. A fallback notification has not already been shown by this Mac app for the current recording window.

Each eligible response item includes an opaque `fallbackIntentId`, display title, display time window, and expiry. The intent is bound to the workspace, meeting, signed in user, Mac device, and recording window. The Mac app uses the intent for start and upload; it does not show the underlying meeting id.

Each signed in Mac app user in the workspace can receive the local notification. This satisfies the all users requirement without server side push. The server still owns a primary recorder policy so multiple users do not create multiple transcripts for the same meeting.

The Mac app shows a local notification:

`Bot did not join. Start local recording?`

Clicking the notification claims the fallback intent and starts recording immediately when the claim succeeds. If another user already claimed the primary local recording, the app shows that the meeting is already being recorded and does not start a second primary recording. There is no website fallback for this notification path because the Mac app owns the notification.

If the user ignores or dismisses the notification, the meeting remains in the menu bar pending list until the fallback intent expires. The app can notify again once during the recording window if the user has not dismissed it and no primary local recorder has started.

## Recording Behavior

The recorder writes two files in a local app data folder:

1. Computer audio track.
2. User microphone track.

The local recording session stores:

1. Recording start time.
2. Recording stop time.
3. Signed in user id.
4. Workspace id from the session.
5. Fallback intent id.
6. Candidate meeting titles and time windows returned during monitoring.
7. Local file paths.
8. Per track format metadata.
9. Upload state.

The user can stop recording from the menu bar app. After stop, upload starts automatically.

## Meeting Matching

The server attaches uploads to the same meeting by recording time and the hidden fallback intent. Time remains the product matching rule, while the intent prevents an upload retry from attaching to the wrong meeting after status or schedule changes.

Start request:

`POST /api/local-recorder/intents/{fallbackIntentId}/start`

The server marks the user's attempt as `started` only if the meeting still has no successful Recall recording evidence and no other active primary local recorder. If the claim is accepted, the app starts recording. If the claim is rejected because another user is already recording, the app shows that state and does not start a competing primary recording.

Upload request:

`POST /api/local-recorder/recordings`

The request includes:

1. Fallback intent id.
2. Client generated recording id for retry dedupe.
3. Recording start time.
4. Recording stop time.
5. Computer audio file.
6. Microphone audio file.
7. Recording manifest.

The recording manifest includes:

1. Per track capture start time.
2. Per track capture stop time.
3. Sample rate.
4. Channel count.
5. Codec.
6. Container.
7. First sample timestamp or equivalent alignment marker.
8. App version.

The server finds eligible missed meetings in the user's workspace whose meeting window overlaps the recording window and match the fallback intent.

If exactly one eligible meeting matches, the upload attaches to that meeting.

If more than one meeting matches, the server returns a conflict response with candidate meeting titles, times, and opaque candidate tokens. The Mac app asks the user which meeting to attach, then retries with the selected candidate token. This is the only place where user choice is required, because time alone is not safe for overlapping meetings.

If no meeting matches, the app keeps the files local and shows an upload blocked state.

## Cloud Storage And Data Model

Add a local recording source without creating a new meeting.

Recommended schema additions:

1. Add `local_recorder` to `asset_source`.
2. Add `computer_audio`, `microphone_audio`, and `synthesized_audio` to `asset_type`, or add an `audio_role` field if keeping `asset_type = audio` is cleaner.
3. Add a `local_recorder_devices` table with user id, workspace id, device id hash, last seen time, app version, and permission readiness.
4. Add a `local_recording_attempts` table with meeting id, user id, device id hash, fallback intent id hash, notification state, attempt state, claim time, expiry time, and error message. Attempt states are `notified`, `started`, `uploading`, `uploaded`, `discarded`, `expired`, and `failed`.
5. Add a `local_recordings` table with meeting id, owner user id, local recording attempt id, client recording id, recording start time, recording stop time, computer audio asset id, microphone audio asset id, synthesized audio asset id, manifest JSON, synthesis status, synthesis error message, and primary source flag.
6. Add a unique constraint on client recording id per user device so upload retries are idempotent.
7. Store all three files in R2.

The normal meeting page reads from the existing meeting id. Technical track assets stay hidden from normal UI.

Only one local recording is primary for a meeting. If more than one user records, the first accepted primary attempt creates the transcript and export source. Later local recordings can be stored for repair but are not transcribed or exported by default.

## Processing Flow

1. Mac app uploads computer audio and microphone audio.
2. Server stores both tracks in R2.
3. Server creates or updates a local recording row for the existing meeting.
4. Server validates manifest metadata, including track duration, sample rate, channel count, codec, and alignment markers.
5. Server synthesizes one audio file from both tracks by aligning track start timestamps and mixing computer audio plus microphone audio into a single exportable file.
6. Server stores synthesized audio in R2.
7. Server creates one transcription job using the synthesized audio.
8. Transcript, summary, share, and search use the same existing meeting surfaces.
9. Export uses the synthesized audio asset.

If track clocks drift beyond the accepted tolerance, synthesis fails with a repair state instead of producing misleading transcript or export audio.

The two original tracks remain available for future diarization and speaker matching.

## Source Precedence

The product keeps one primary recording source per meeting.

1. If Recall produces audio before a local fallback claim starts, Recall remains primary and the Mac app stops seeing the meeting as eligible.
2. If a local fallback claim starts first, the local recording becomes the primary source for transcript and export after upload and synthesis.
3. If Recall produces audio after a local fallback claim starts, the Recall asset is stored as secondary evidence but does not create a second transcript or replace export by default.
4. If local upload or synthesis fails and Recall later has usable audio, the server can promote Recall as the primary source through a repair action.
5. The meeting page shows one transcript and one export source at a time.

## Website Behavior

The dashboard keeps showing the original calendar meeting.

The meeting page shows:

1. The normal transcript state.
2. A small source label when the meeting was recorded locally.
3. A retry state if local upload or synthesis failed.

The page does not show meeting ids or two technical track files to normal users.

## Failure Handling

1. If the user is not logged in, the Mac app does not monitor.
2. If permissions are missing, the Mac app does not monitor.
3. If the bot later joins successfully before any local claim starts, the server stops returning the meeting as eligible.
4. If the bot joins after local recording starts, the Mac app continues recording because the local recording has become the fallback primary source.
5. If recording is active and the app quits, it should recover any closed files on next launch and offer upload.
6. If upload fails, both tracks stay local and retry later.
7. If synthesis fails, the meeting shows a repair state and export remains unavailable until synthesis succeeds.
8. If matching is ambiguous, the app asks the user to choose from candidate meetings.

## Verification

Implementation should prove:

1. A meeting one minute past start with no Recall recording is eligible.
2. A meeting with a Recall recording id is not eligible.
3. A meeting without a meeting link is not eligible.
4. The Mac polling endpoint returns only meetings visible to the signed in user's workspace.
5. The polling endpoint returns fallback intents instead of raw meeting ids.
6. A start claim prevents two primary local recorders for the same meeting.
7. A local recording upload attaches to the existing meeting, not a new meeting.
8. Overlapping meetings return a conflict instead of guessing.
9. Conflict retry uses opaque candidate tokens.
10. Computer and microphone tracks are stored separately.
11. The local recording row links computer audio, microphone audio, and synthesized audio assets.
12. Synthesis validates the recording manifest before creating export audio.
13. Synthesis creates one exportable audio asset.
14. Export returns synthesized audio for locally recorded meetings.
15. A late Recall recording does not create a second transcript after local recording starts.
16. Failed uploads stay retryable from local disk.

## Success Criteria

The feature is complete when a signed in macOS 15 plus user can install the Mac app, grant permissions, receive a local notification within the fallback window after a missed bot join, click it to claim and start recording, stop recording, upload automatically, and then see the same meeting on the website with transcript processing and synthesized audio export.
