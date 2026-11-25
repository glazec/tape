import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { withDatabaseWorkspace } from "@/db/rls-context";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { getMeetingOwnerWorkspace } from "@/lib/meeting-followup-generation";
import {
  currentTimelineObservations, extractPersonTimeline, projectPersonTimeline, storedObservationsSchema,
  timelineHash, TIMELINE_PROMPT_VERSION, type TimelineMeeting, type TimelineSource,
} from "@/lib/person-timeline";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import type { WorkspaceContext } from "@/lib/workspace";

const REFRESH_LIMIT = 4;
const INPUT_CHARS = 28_000;

const jobs = currentTranscriptJobIdsSubquery(sql`m.id`);
const meetingDate = sql`coalesce(m.started_at, (select starts_at from calendar_events where id = m.calendar_event_id), m.created_at)`;
const allowPersonal = sql`greatest(
  (select count(*) from meeting_attendees a where a.meeting_id = m.id),
  (select count(distinct coalesce(nullif(lower(t.email), ''), t.recall_participant_id, nullif(lower(t.name), '')))
    from meeting_participant_timeline t where t.meeting_id = m.id),
  (select count(distinct coalesce(g.person_id::text, nullif(lower(g.display_name), ''), g.id::text))
    from meeting_speakers g where g.meeting_id = m.id and g.job_id in ${jobs})
) <= 5`;

type MeetingRow = { id: string; at: Date | string; includePersonal: boolean; observations: unknown };
const personCondition = (workspace: WorkspaceContext, personId: string) => sql`
  m.team_id = ${workspace.teamId} and m.status <> 'cancelled' and app_private.can_read_meeting(m.id)
  and exists (
    select 1 from workspace_people p where p.id = ${personId} and p.team_id = m.team_id
      and p.merged_into_id is null and app_private.is_internal_member(m.team_id)
      and not app_private.is_person_colleague(p.id)
      and not exists (
        select 1 from person_emails pe join users u on lower(u.email) = pe.email
        where pe.person_id = p.id and u.id = m.owner_user_id
      )
  )`;

export async function getPersonTimeline(workspace: WorkspaceContext, personId: string) {
  const { rows } = await db.execute<MeetingRow & { segments: TimelineMeeting["segments"] }>(sql`
    select m.id, ${meetingDate} as at, ${allowPersonal} as "includePersonal", e.observations,
      coalesce((
        select jsonb_agg(jsonb_build_object('id', s.id, 'text', s.text))
        from transcript_segments s join meeting_speakers g on g.id = s.meeting_speaker_id
        where s.meeting_id = m.id and s.job_id in ${jobs} and g.person_id = e.person_id
          and s.id in (
            select segment_id::uuid from jsonb_array_elements(e.observations) observation
            cross join lateral jsonb_array_elements_text(observation->'segmentIds') segment_id
          )
      ), '[]'::jsonb) as segments
    from person_timeline_evidence e join meetings m on m.id = e.meeting_id
    where e.person_id = ${personId} and ${personCondition(workspace, personId)}`);
  const sources: TimelineSource[] = rows.flatMap(row => {
    const parsed = storedObservationsSchema.safeParse(row.observations);
    if (!parsed.success) return [];
    const current = currentTimelineObservations(parsed.data, new Map(row.segments.map(segment => [segment.id, segment.text])));
    return [{
      meetingId: row.id, at: new Date(row.at).toISOString(),
      observations: row.includePersonal ? current : current.filter(item => item.category === "project" || item.category === "focus"),
    }];
  });
  return projectPersonTimeline(sources);
}

function fitSegments(segments: TimelineMeeting["segments"]) {
  if (segments.reduce((size, segment) => size + segment.text.length, 0) <= INPUT_CHARS) return segments;
  // Keep evidence from the beginning, middle and end of long calls.
  const windows = 8;
  const size = Math.ceil(segments.length / windows);
  return Array.from({ length: windows }, (_, index) => {
    let remaining = Math.floor(INPUT_CHARS / windows);
    return segments.slice(index * size, (index + 1) * size).filter(segment => {
      if (segment.text.length > remaining) return false;
      remaining -= segment.text.length;
      return true;
    });
  }).flat();
}

export async function refreshPersonTimeline(workspace: WorkspaceContext, personId: string, meetingId?: string) {
  const extractedAt = new Date();
  const { rows } = await db.execute<{
    id: string; at: Date | string; includePersonal: boolean; fingerprint: string; sourceHash: string | null;
  }>(sql`
    select m.id, ${meetingDate} as at, ${allowPersonal} as "includePersonal",
      subject.fingerprint, e.source_hash as "sourceHash"
    from meetings m
    join lateral (
      select md5(string_agg(s.id::text || md5(s.text), '' order by s.start_ms, s.id)) as fingerprint
      from transcript_segments s join meeting_speakers g on g.id = s.meeting_speaker_id
      where s.meeting_id = m.id and s.job_id in ${jobs} and g.person_id = ${personId}
    ) subject on subject.fingerprint is not null
    left join person_timeline_evidence e on e.person_id = ${personId} and e.meeting_id = m.id
    where ${personCondition(workspace, personId)}
      ${meetingId ? sql`and m.id = ${meetingId}` : sql`and m.id in (select meeting_id from meeting_speakers where person_id = ${personId})`}
    order by at desc, m.id`);
  const pending = rows.flatMap(row => {
    const at = new Date(row.at).toISOString();
    const sourceHash = timelineHash([TIMELINE_PROMPT_VERSION, row.fingerprint, at, row.includePersonal]);
    return sourceHash === row.sourceHash ? [] : [{ ...row, at, sourceHash }];
  });
  if (!pending.length) return { remaining: 0 };

  await assertWorkspaceHasProviderCredit(workspace);
  // Each provider request sees one meeting. Its output can safely follow that
  // meeting's permissions, even when two viewers can open different sources.
  const batch = pending.slice(0, REFRESH_LIMIT);
  const results = await Promise.allSettled(batch.map(async meeting => {
    const { rows: segments } = await db.execute<TimelineMeeting["segments"][number] & { fingerprint: string; includePersonal: boolean; at: string | Date }>(sql`
      with source as materialized (
        select m.id, ${allowPersonal} as "includePersonal", ${meetingDate} as at
        from meetings m where m.id = ${meeting.id} and ${personCondition(workspace, personId)}
      )
      select s.id, s.text, m."includePersonal", m.at, md5(string_agg(s.id::text || md5(s.text), '') over (
        order by s.start_ms, s.id rows between unbounded preceding and unbounded following
      )) as fingerprint
      from source m join transcript_segments s on s.meeting_id = m.id
      join meeting_speakers g on g.id = s.meeting_speaker_id
      where s.job_id in ${jobs} and g.person_id = ${personId}
      order by s.start_ms, s.id`);
    const [current] = segments;
    if (!current || current.fingerprint !== meeting.fingerprint || current.includePersonal !== meeting.includePersonal
      || new Date(current.at).toISOString() !== meeting.at) return false;
    const source = await extractPersonTimeline({
      id: meeting.id, at: meeting.at, includePersonal: meeting.includePersonal,
      segments: fitSegments(segments.map(({ id, text }) => ({ id, text }))),
    }, { personId });
    await db.execute(sql`
      insert into person_timeline_evidence (person_id, meeting_id, source_hash, observations, extracted_at)
      values (${personId}::uuid, ${meeting.id}::uuid, ${meeting.sourceHash}, ${JSON.stringify(source.observations)}::jsonb, ${extractedAt}::timestamptz)
      on conflict (person_id, meeting_id) do update set source_hash = excluded.source_hash,
        observations = excluded.observations, extracted_at = excluded.extracted_at
      where person_timeline_evidence.extracted_at < excluded.extracted_at`);
    return true;
  }));
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  return { remaining: pending.length - results.filter(result => result.status === "fulfilled" && result.value).length };
}

export async function refreshPersonTimelineAfterMeeting(meetingId: string, personId: string) {
  const workspace = await getMeetingOwnerWorkspace(meetingId);
  if (!workspace) return { remaining: 0 };
  return withDatabaseWorkspace(workspace, () => refreshPersonTimeline(workspace, personId, meetingId));
}
