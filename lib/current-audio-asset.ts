import { sql } from "drizzle-orm";
import { mediaAssets, meetings, recordings } from "@/db/schema";
import { activeTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";

// A replacement upload takes precedence over synthesized audio from an older recording.
export function currentAudioAssetPriority() {
  return sql`case when exists (
    select 1 from transcript_jobs audio_job
    where audio_job.meeting_id = ${meetings.id}
      and audio_job.id in ${activeTranscriptJobIdsSubquery(meetings.id)}
      and (audio_job.media_asset_id = ${mediaAssets.id}
        or audio_job.recording_id = ${mediaAssets.recordingId})
  ) then 1 else 0 end`;
}

export function currentRecordingCondition(meetingId: unknown) {
  return sql`(
    not exists (
      select 1 from transcript_jobs active_recording_job
      where active_recording_job.meeting_id = ${meetingId}
        and active_recording_job.recording_id is not null
        and active_recording_job.id in ${activeTranscriptJobIdsSubquery(meetingId)}
    ) or ${recordings.id} in (
      select recording_id from transcript_jobs
      where id in ${activeTranscriptJobIdsSubquery(meetingId)}
    )
  )`;
}

// Uploaded replacement audio has no images; historical capture images belong to the old recording.
export function currentVisualAssetCondition(meetingId: unknown) {
  return sql`not exists (
    select 1 from transcript_jobs active_audio_job
    inner join media_assets active_audio on active_audio.id = active_audio_job.media_asset_id
    where active_audio_job.meeting_id = ${meetingId}
      and active_audio_job.id in ${activeTranscriptJobIdsSubquery(meetingId)}
      and active_audio.source = 'upload'
      and active_audio.type = 'audio'
  )`;
}
