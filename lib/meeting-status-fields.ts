import { sql, type SQL } from "drizzle-orm";
import { meetings, transcriptJobs } from "@/db/schema";
import { activeTranscriptJobIdsSubquery, currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import type { SpeakerLabelCounts, TranscriptJobStatus } from "@/lib/meeting-display-status";

export function speakerLabelCounts(meetingIds: SQL) {
  return sql<SpeakerLabelCounts>`(
    select json_build_object('total', count(*), 'unlabeled', count(*) filter (
      where g.person_id is null and btrim(coalesce(g.display_name, g.source_label, ''))
        ~* '^(|unknown( speaker)?|guest|participant|(.+ · )?speaker[ _-]*[0-9]+|pc sound( [0-9]+)?)$'
    ))
    from meeting_speakers g
    where g.meeting_id in (${meetingIds})
      and g.job_id in ${currentTranscriptJobIdsSubquery(sql`g.meeting_id`)}
      and exists (select 1 from transcript_segments s
        where s.meeting_id = g.meeting_id and s.meeting_speaker_id = g.id)
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
      select case
        when exists (
          select 1 from ${transcriptJobs} active_job
          where active_job.id in ${activeTranscriptJobIdsSubquery(meetings.id)}
            and active_job.status = 'running'
        ) then 'running'::job_status
        when exists (
          select 1 from ${transcriptJobs} active_job
          where active_job.id in ${activeTranscriptJobIdsSubquery(meetings.id)}
            and active_job.status = 'queued'
        ) then 'queued'::job_status
        when exists (
          select 1 from ${transcriptJobs} active_job
          where active_job.id in ${activeTranscriptJobIdsSubquery(meetings.id)}
            and active_job.status = 'failed'
        ) then 'failed'::job_status
        when exists (
          select 1 from ${transcriptJobs} active_job
          where active_job.id in ${activeTranscriptJobIdsSubquery(meetings.id)}
            and active_job.status = 'completed'
        ) then 'completed'::job_status
        else null
      end
    )`,
    speakerLabelCounts: speakerLabelCounts(sql`
      select ${meetings.id} union all
      select p.source_meeting_id from meeting_parts p
      where p.meeting_id = ${meetings.id} and app_private.can_read_meeting(p.source_meeting_id)
    `),
  };
}
