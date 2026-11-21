import { sql, type SQL } from "drizzle-orm";
import { meetings } from "@/db/schema";
import { activeTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import type { SpeakerLabelCounts, TranscriptJobStatus } from "@/lib/meeting-display-status";

export function speakerLabelCounts(meetingIds: SQL) {
  // Match the speaking time percentages displayed in the transcript viewer.
  const duration = sql`greatest(1, s.end_ms - s.start_ms)`;
  return sql<SpeakerLabelCounts>`(
    select json_build_object('total', coalesce(sum(${duration}), 0), 'unlabeled', coalesce(sum(${duration}) filter (
      where g.person_id is null and btrim(coalesce(g.display_name, g.source_label, ''))
        ~* '^(|unknown( speaker)?|guest|participant|(.+ · )?speaker[ _-]*[0-9]+|pc sound( [0-9]+)?)$'
    ), 0))
    from meeting_speakers g
    join transcript_segments s on s.meeting_id = g.meeting_id and s.meeting_speaker_id = g.id
    where g.meeting_id = any(array(${meetingIds}))
      and g.job_id = any(array(
        select j.id from (${meetingIds}) source(id)
        join transcript_jobs j on j.meeting_id = source.id and j.status = 'completed'
        where j.id = any(array(select active.id from ${activeTranscriptJobIdsSubquery(sql`source.id`)} active(id)))
      ))
  )`;
}

export function meetingStatusFields() {
  return {
    status: sql<(typeof meetings.$inferSelect)["status"]>`case
      when ${meetings.status} = 'recording' or exists (select 1 from meeting_parts p join meetings child on child.id=p.source_meeting_id
        where p.meeting_id=${meetings.id} and app_private.can_read_meeting(child.id) and child.status='recording') then 'recording'::meeting_status
      when exists (select 1 from meeting_parts p join meetings child on child.id=p.source_meeting_id
        where p.meeting_id=${meetings.id} and app_private.can_read_meeting(child.id) and child.status='scheduled') then 'scheduled'::meeting_status
      when exists (select 1 from meeting_parts p join meetings child on child.id=p.source_meeting_id
        where p.meeting_id=${meetings.id} and app_private.can_read_meeting(child.id) and child.status='processing') then 'processing'::meeting_status
      when exists (select 1 from meeting_parts p join meetings child on child.id=p.source_meeting_id
        where p.meeting_id=${meetings.id} and app_private.can_read_meeting(child.id) and child.status='failed') then 'failed'::meeting_status
      else ${meetings.status} end`,
    transcriptJobStatus: sql<TranscriptJobStatus | null>`(
      select active_job.status from transcript_jobs active_job
      where active_job.meeting_id = ${meetings.id}
        and active_job.id in ${activeTranscriptJobIdsSubquery(meetings.id)}
        and active_job.status in ('running', 'queued', 'failed', 'completed')
      order by case active_job.status when 'running' then 1 when 'queued' then 2
        when 'failed' then 3 else 4 end
      limit 1
    )`,
    speakerLabelCounts: speakerLabelCounts(sql`
      select ${meetings.id} union all
      select p.source_meeting_id from meeting_parts p
      where p.meeting_id = ${meetings.id} and app_private.can_read_meeting(p.source_meeting_id)
    `),
  };
}
