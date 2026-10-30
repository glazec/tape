import { sql } from "drizzle-orm";
import { activeTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";

// Run after segment insertion and duration updates, inside the same meeting lock.
// Offsets concatenate captured media; wall clock gaps and overlaps do not insert
// silence or discard audio. Generation membership remains defined by job history.
export function recordingTimelineRebaseQuery(meetingId: string) {
  return sql`
    with active as materialized (
      select job.id as job_id, job.mode, job.created_at, job.recording_offset_ms,
        recording.started_at, coalesce(recording.duration_ms, 0) as duration_ms
      from transcript_jobs job
      join recordings recording on recording.id = job.recording_id
      where job.id in ${activeTranscriptJobIdsSubquery(meetingId)}
    ), offsets as materialized (
      select job_id,
        coalesce(sum(duration_ms) over (
          order by coalesce(started_at, created_at), created_at, job_id
          rows between unbounded preceding and 1 preceding
        ), 0)::integer as new_offset,
        coalesce(recording_offset_ms, case when mode = 'replace' then 0 else
          coalesce(sum(duration_ms) over (
            order by created_at, job_id rows between unbounded preceding and 1 preceding
          ), 0)::integer end) as old_offset
      from active
    ), shifted as (
      update transcript_segments segment
      set start_ms = segment.start_ms + offsets.new_offset - offsets.old_offset,
        end_ms = segment.end_ms + offsets.new_offset - offsets.old_offset
      from offsets
      where segment.job_id = offsets.job_id and offsets.new_offset <> offsets.old_offset
      returning segment.id
    )
    update transcript_jobs job set recording_offset_ms = offsets.new_offset
    from offsets where job.id = offsets.job_id
  `;
}
