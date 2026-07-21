import { sql } from "drizzle-orm";

import { db } from "@/db/client";

const STALE_MEETING_JOB_TIMEOUT_MS = 6 * 60 * 60 * 1_000;

export async function reconcileStaleMeetingJobs(
  input: { now?: Date } = {},
) {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - STALE_MEETING_JOB_TIMEOUT_MS);
  const rows = await db.execute<{
    failed_processing_count: number;
    failed_recording_count: number;
    failed_transcript_job_count: number;
    failed_translation_count: number;
  }>(sql`
    with stale_transcript_jobs as (
      update transcript_jobs
      set
        status = 'failed',
        error_message = 'Transcription timed out before completion',
        updated_at = ${now}
      where status in ('queued', 'running')
        and updated_at < ${cutoff}
      returning meeting_id
    ),
    failed_meetings as (
      update meetings as meeting
      set
        status = 'failed',
        updated_at = ${now}
      where meeting.status = 'processing'
        and (
          meeting.id in (select meeting_id from stale_transcript_jobs)
          or (
            meeting.updated_at < ${cutoff}
            and not exists (
              select 1
              from transcript_jobs as any_job
              where any_job.meeting_id = meeting.id
                and any_job.status in ('queued', 'running', 'completed')
            )
          )
        )
        and not exists (
          -- Keep the meeting processing while any job could still succeed:
          -- a completed job, or a fresh (non-stale) queued/running retry.
          -- CTEs read the pre-update snapshot, so the jobs being failed above
          -- are correctly excluded here by the cutoff on updated_at.
          select 1
          from transcript_jobs as alive
          where alive.meeting_id = meeting.id
            and (
              alive.status = 'completed'
              or (
                alive.status in ('queued', 'running')
                and alive.updated_at >= ${cutoff}
              )
            )
        )
      returning meeting.id
    ),
    failed_translations as (
      update meetings
      set
        translation_status = 'failed',
        translation_error_message = 'Translation timed out before completion',
        updated_at = ${now}
      where translation_status in ('queued', 'running')
        and coalesce(translation_started_at, updated_at) < ${cutoff}
      returning id
    ),
    stale_recording_meetings as (
      update meetings as meeting
      set
        status = 'failed',
        updated_at = ${now}
      where meeting.status = 'recording'
        -- Only local-recorder recordings whose owning device has gone silent.
        -- meetings.updated_at is not a liveness signal (nothing bumps it
        -- mid-capture), so a live long recording would be wrongly failed;
        -- the device polls monitoring ~every 60s, so a stale last_seen_at is
        -- the real "app is gone" signal. Bot recordings have no attempt row
        -- and are governed by Recall webhooks, so they are excluded here.
        and exists (
          select 1
          from local_recording_attempts as attempt
          join local_recorder_devices as device
            on device.user_id = attempt.user_id
            and device.device_id_hash = attempt.device_id_hash
          where attempt.meeting_id = meeting.id
            and attempt.attempt_state in ('started', 'uploading')
            and device.last_seen_at < ${cutoff}
        )
      returning meeting.id
    )
    select
      (select count(*)::integer from stale_transcript_jobs)
        as failed_transcript_job_count,
      (select count(*)::integer from failed_meetings)
        as failed_processing_count,
      (select count(*)::integer from failed_translations)
        as failed_translation_count,
      (select count(*)::integer from stale_recording_meetings)
        as failed_recording_count
  `);
  const result = rows.rows[0];

  return {
    failedProcessingCount: Number(result?.failed_processing_count ?? 0),
    failedRecordingCount: Number(result?.failed_recording_count ?? 0),
    failedTranscriptJobCount: Number(result?.failed_transcript_job_count ?? 0),
    failedTranslationCount: Number(result?.failed_translation_count ?? 0),
  };
}
