# Railway Screen Share Frame Extraction Design

> Historical design record from July 10, 2026. The Railway image worker is implemented. Use the [README](../../../README.md), [setup guide](../../setup.md), and [testing architecture](../../testing.md) for current architecture and commands.

## Goal

Automatically capture every distinct, stable screen shared visual from completed [Recall.ai](https://www.recall.ai/) meeting recordings. Do not capture gallery views or participant camera views. Preserve enough source detail for colleagues to read presentation text.

The website remains on [Vercel](https://vercel.com/). A dedicated image worker on [Railway](https://railway.com/) owns ffmpeg processing.

## Approved Product Decisions

1. Native Recall screenshots are not a reliable source and are removed from the new meeting processing path.
2. The application generates screenshots from Recall mixed video with ffmpeg.
3. Screenshots are created only during confirmed screen sharing intervals.
4. Meetings without screen sharing produce no screenshots.
5. There is no meeting level screenshot count limit.
6. Every distinct visual state that becomes stable is eligible for capture.
7. Repeated slides are deduplicated, including slides revisited later in the meeting.
8. Final files are high quality JPEG images at the original video resolution.
9. Participant video is hidden from future mixed recordings while a screen share is active.
10. Only the image worker runs on Railway. The rest of the product stays on Vercel.

## Current Product Evidence

The existing application already provides most of the product boundary:

1. `media_assets` supports `video_frame`, `capturedAt`, and `timestampMs`.
2. Protected meeting image routes enforce the existing meeting access policy.
3. Meeting detail queries return screenshots and video frames in timestamp order.
4. The transcript viewer renders all returned images in a lazy loaded horizontal timeline and supports jumping to the matching transcript time.
5. Cloudflare R2 stores binary meeting assets.
6. Inngest already coordinates durable meeting processing work.
7. ffmpeg is already used for uploaded video conversion.

Production probes established the input constraints:

1. All 16 completed Recall recordings inspected expose downloadable participant event artifacts.
2. Eleven of those recordings contain `screenshare_on` and `screenshare_off` events with relative recording timestamps.
3. Five representative mixed videos were probed with ffprobe. All five are 1280 by 720 at 30 frames per second.
4. Recall mixed video exists even when the native Recall screenshot endpoint returns no images.

## Architecture Boundary

### Vercel Application

The existing Vercel application remains responsible for:

1. Website rendering and authentication.
2. Meeting access control.
3. Recall status webhooks.
4. Creating the image extraction Inngest event.
5. Reading image metadata.
6. Redirecting authorized image requests to signed R2 URLs.

Vercel does not execute ffmpeg for this feature.

### Railway Image Worker

Railway hosts a small Node service dedicated to image extraction. It exposes only:

1. An Inngest serve endpoint containing image processing functions.
2. A health endpoint for deployment checks.

The service does not host Next.js pages or general application APIs. It uses a system ffmpeg installation from its container image instead of depending on Vercel function packaging.

Railway Serverless is enabled. Database connections are created only while a job is active and closed after the job finishes so an idle worker can sleep. Initial extraction concurrency is one.

### Inngest Event Contract

The Vercel application sends `meeting/extract.video-frames` after Recall reports that recording media is complete.

The event contains only:

1. `meetingId`
2. `recallBotId`
3. `recallRecordingId`

Recall signed download URLs are not stored in Inngest events, logs, or Postgres. The Railway job retrieves fresh URLs from Recall on every attempt because Recall download URLs expire.

## Recall Recording Configuration

All paths that create or update a Recall bot use:

```json
{
  "recording_config": {
    "video_mixed_participant_video_when_screenshare": "hide"
  }
}
```

This setting makes the shared content occupy the mixed video frame without participant camera tiles during future screen shares.

The setting must be applied consistently to:

1. Manually scheduled bots.
2. Calendar event bots.
3. Updates to already scheduled bots.

Scheduled future bots are refreshed after deployment so they receive the same recording configuration.

## Screen Share Interval Detection

The worker downloads `participant_events_download_url` from the recording participant event media shortcut.

Each event includes an `action` and a timestamp with seconds relative to the recording. The worker builds intervals as follows:

1. `screenshare_on` opens an interval for that participant.
2. `screenshare_off` closes that participant's active interval.
3. An unmatched `screenshare_on` closes at the recording duration.
4. An unmatched `screenshare_off` is ignored.
5. Overlapping intervals are merged because the output is one mixed video.
6. Intervals shorter than two seconds do not produce a screenshot because no stable state can be established.

If a valid participant event artifact contains no screen share intervals, the worker succeeds with zero images. A missing or malformed participant event artifact fails the attempt and is retried. The worker never inspects the full meeting as a visual fallback. This fail closed rule prevents gallery and participant camera frames from entering the product.

## Stable Visual Detection

The worker scans only merged screen share intervals.

### Sampling

1. ffmpeg samples one frame per second inside each interval.
2. Detection frames are converted to 160 by 90 grayscale thumbnails.
3. The worker compares each thumbnail with the last stable accepted state.

The comparison uses two measurements:

1. Mean absolute grayscale pixel difference.
2. The percentage of pixels whose absolute difference is at least 20 grayscale levels.

A frame becomes a change candidate when either:

1. Mean absolute difference is at least 3.0.
2. At least 0.8 percent of thumbnail pixels changed by 20 or more grayscale levels.

Using both measurements allows small but meaningful presentation changes, such as a newly revealed bullet, while ignoring a moving cursor.

### Stability

A change candidate is accepted only when a sample two seconds later is visually stable against it:

1. Mean absolute difference is no more than 1.5.
2. No more than 0.5 percent of pixels changed by 20 or more grayscale levels.

If the candidate is still changing, the worker keeps scanning until the content stabilizes. Slide transitions, scrolling, animations, and moving video therefore do not immediately become screenshots.

The first stable state after a screen share begins is eligible for capture. Presentation builds are also eligible when each build produces a distinct state that remains stable for at least two seconds.

### Global Deduplication

Every accepted candidate is compared with all previously accepted thumbnails from the same recording. It is considered a duplicate when both stability thresholds are satisfied.

This prevents duplicate images when:

1. A presenter returns to an earlier slide.
2. A cursor moves over an otherwise unchanged slide.
3. Multiple overlapping screen share events describe the same mixed video content.

There is no final count cap. Dedupe and stability determine the number of screenshots.

## Final JPEG Extraction

For every accepted timestamp, ffmpeg seeks directly to the source video timestamp and emits one JPEG.

Output rules:

1. Preserve the source width and height.
2. Do not downscale.
3. Do not upscale.
4. Use ffmpeg JPEG quality level 2.
5. Use 4:4:4 chroma sampling to protect colored text edges.
6. Validate that output is a nonempty JPEG before upload.

The current Recall videos are 1280 by 720. Upscaling them to 1920 by 1080 would increase storage without restoring text detail, so the worker preserves 1280 by 720. If Recall later provides a higher resolution source, the worker preserves that higher source resolution automatically.

## Persistence And Idempotency

Each accepted JPEG is uploaded to [Cloudflare R2](https://developers.cloudflare.com/r2/) and inserted into `media_assets` with:

1. `source = recall`
2. `type = video_frame`
3. JPEG MIME type
4. File size
5. SHA 256 checksum
6. Relative `timestampMs`
7. Absolute `capturedAt` derived from recording start time

Object keys include:

1. Team and meeting ownership path.
2. Recall recording ID.
3. Extractor version `screen-share-v1`.
4. Timestamp in milliseconds.

The deterministic key and existing bucket plus object key uniqueness constraint make retries idempotent. A retry skips frames already persisted and resumes incomplete work.

The extractor version in the key allows a future algorithm to be run without silently replacing existing assets.

## Processing And Retry Rules

1. Recording completion and transcription remain independent from image extraction.
2. Image extraction failure never delays or fails transcription.
3. Inngest retries the image job twice after the first failed attempt.
4. Every retry retrieves fresh Recall media URLs.
5. A partially completed job resumes through deterministic object keys.
6. A missing mixed video is retryable while Recall media processing may still be completing.
7. A valid participant event artifact with no screen share intervals is a successful zero image result.
8. A missing or invalid participant event artifact, ffmpeg failure, R2 failure, and database failure are recorded as job failures and retried.

## Historical Recordings

Historical recordings can use their existing participant event artifacts to exclude gallery only periods. However, those recordings used Recall's default `overlap` behavior, so a participant camera overlay may remain on top of shared content.

The first release does not promise clean historical backfill. Historical extraction is run only after the new pipeline succeeds on future recordings. Removing overlays from old recordings would require a separate crop or visual classification design.

## User Experience

The existing meeting image timeline remains the first release surface.

1. All image metadata is returned in timestamp order.
2. Browser image loading remains lazy.
3. Selecting an image opens the original high quality JPEG.
4. Jump to transcript seeks to the corresponding meeting time.
5. Meetings without screen sharing show no empty screenshot section.

The first release does not add pagination because presentation sized image sets remain practical in the existing lazy loaded horizontal timeline. Pagination can be added when measured meetings produce enough images to affect page performance.

## Security And Privacy

1. Recall signed URLs are retrieved only inside the active worker job.
2. Signed URLs are never persisted or logged.
3. Railway receives only the secrets required for Recall reads, R2 writes, Inngest verification, and database access.
4. The R2 credential is scoped to the meeting media bucket when supported.
5. The existing protected image route remains the only product access path.
6. Images inherit meeting access policy and are not public objects.
7. Pure participant camera and gallery frames are never persisted by this feature.

Meeting deletion currently removes database rows without deleting all associated R2 objects. General media deletion from R2 remains a separate retention project and is not silently expanded inside this feature.

## Deployment Configuration

Railway starts with:

1. Hobby plan.
2. One GB memory limit.
3. One extraction job at a time.
4. Serverless sleep enabled.
5. A 10 dollar compute hard limit.
6. Structured logs to standard output.
7. A container health check.

The website and all existing Vercel functions remain unchanged except for creating the image extraction event and removing native screenshot ingestion from the recording completion path.

## Cost Model

Compute scales primarily with total screen sharing duration. Final image storage scales with the number of stable visual states.

At 200 to 500 KB per high quality 1280 by 720 JPEG:

1. A 60 slide presentation stores approximately 12 to 30 MB.
2. One thousand such meetings store approximately 12 to 30 GB for each retained monthly cohort.
3. At standard R2 pricing, that cohort costs approximately 0.18 to 0.45 dollars per month before the R2 free storage allowance.
4. Sixty thousand writes for one thousand 60 slide meetings remain below R2's monthly free Class A operation allowance.

The Railway Hobby plan has a five dollar monthly minimum that includes five dollars of resource usage. The expected initial volume should remain inside that allowance. Runtime and memory measurements from the canary determine whether concurrency or the spending limit should change.

## Observability

Each extraction run records structured metrics without signed URLs:

1. Meeting ID and recording ID.
2. Number and total duration of screen share intervals.
3. Number of sampled frames.
4. Number of change candidates.
5. Number rejected as unstable.
6. Number rejected as duplicates.
7. Number of JPEGs persisted.
8. Scan duration and render duration.
9. Total JPEG bytes written.
10. Final status and sanitized error category.

Initial operational targets:

1. No gallery only images in the canary set.
2. No duplicate rate above 10 percent in manual review.
3. Every stable presentation state lasting at least two seconds is represented.
4. Text in the JPEG is no less readable than the same source video frame.
5. Image extraction failures remain below one percent after retries.

## Testing Strategy

### Unit Tests

1. Pair screen share on and off events.
2. Close unmatched screen share on events at recording end.
3. Ignore unmatched screen share off events.
4. Merge overlapping screen share intervals.
5. Return zero intervals when no screen sharing occurred.
6. Detect a full slide change.
7. Detect a persistent bullet reveal.
8. Ignore cursor sized changes.
9. Reject an unstable transition.
10. Reject a revisited duplicate slide.
11. Preserve unlimited distinct stable states.
12. Generate deterministic object keys.

### Worker Integration Tests

1. Process a fixture video with gallery content followed by screen sharing and persist only screen share frames.
2. Process a presentation containing repeated slides and persist each unique stable state once.
3. Verify JPEG dimensions equal source dimensions.
4. Verify retries do not duplicate R2 objects or database rows.
5. Verify an expired Recall URL is replaced on retry.
6. Verify transcription remains independent when extraction fails.

### Production Canary

1. Deploy the Railway worker without backfill.
2. Process three future meetings with screen sharing.
3. Manually compare every persisted image against the corresponding video interval.
4. Expand to ten meetings after the first three pass.
5. Review image count, duplicate rate, text readability, runtime, and Railway usage.
6. Enable historical extraction only through a separately approved backfill run.

## Acceptance Criteria

The feature is complete when:

1. Future Recall recordings hide participant cameras while screen sharing.
2. A completed screen sharing meeting automatically creates high quality `video_frame` assets.
3. A meeting without screen sharing creates no visual assets.
4. Gallery and participant camera periods never produce screenshots.
5. There is no arbitrary screenshot count cap.
6. Repeated and unstable frames are excluded.
7. Final JPEG dimensions match the source video.
8. Images appear in chronological order and jump to the matching transcript time.
9. Retries are idempotent.
10. Vercel performs no ffmpeg work for this feature.
11. Railway usage remains under the configured hard spending limit.

## Out Of Scope

1. Moving the website or general APIs from Vercel to Railway.
2. Capturing participant camera views.
3. Face detection or AI image classification.
4. Cropping participant overlays from historical recordings.
5. Creating resolution that does not exist in the source video.
6. Historical backfill during the initial canary.
7. General R2 media retention cleanup.
