import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { databaseSql } from "@/db/client";
import type { WorkspaceContext } from "@/lib/workspace";

// Both the picker and completion evaluate this against the same meeting alias.
export const recordingImportUnavailableReason = sql`case
  when m.status = 'cancelled' then 'This meeting was cancelled'
  when m.status in ('recording', 'processing') or m.bot_state is not null
    then 'This meeting has an active recording or bot'
  when m.recall_bot_id is not null then 'This meeting has a bot attached. Open it to review.'
  when exists (select 1 from local_recording_attempts a where a.meeting_id = m.id
    and (a.attempt_state in ('sealed', 'uploading', 'uploaded')
      or (a.attempt_state = 'started' and a.expires_at > now())))
    then 'Another recording is using this meeting'
  when m.recall_recording_id is not null
    or exists (select 1 from recordings r where r.meeting_id = m.id)
    or exists (select 1 from local_recordings r where r.meeting_id = m.id)
    or exists (select 1 from media_assets a where a.meeting_id = m.id)
    or exists (select 1 from transcript_jobs j where j.meeting_id = m.id)
    or exists (select 1 from transcript_segments s where s.meeting_id = m.id)
    then 'This meeting already has a recording or transcript'
  else null end`;

export function recordingImportPermission(workspace: WorkspaceContext) {
  return sql`m.team_id = ${workspace.teamId}::uuid
    and (m.owner_user_id = ${workspace.userId}::uuid or exists (
      select 1 from team_memberships membership where membership.team_id = m.team_id
        and membership.user_id = ${workspace.userId}::uuid and membership.role in ('owner', 'admin')
    ))`;
}

export type UploadMeetingCandidate = {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  unavailableReason: string | null;
};

export async function listUploadMeetingCandidates(input: {
  workspace: WorkspaceContext;
  startedAt: Date;
  durationMs?: number;
}) {
  const endedAt = new Date(input.startedAt.getTime() + (input.durationMs ?? 0));
  const windowStart = new Date(input.startedAt.getTime() - 3 * 60 * 60 * 1000);
  const windowEnd = new Date(endedAt.getTime() + 3 * 60 * 60 * 1000);
  const query = new PgDialect().sqlToQuery(sql`
    select m.id, m.title, coalesce(m.started_at, e.starts_at) as "startedAt",
      coalesce(m.ended_at, e.ends_at) as "endedAt",
      ${recordingImportUnavailableReason} as "unavailableReason"
    from meetings m join calendar_events e on e.id = m.calendar_event_id
    where ${recordingImportPermission(input.workspace)}
      and e.team_id = ${input.workspace.teamId}::uuid
      and (m.owner_user_id = ${input.workspace.userId}::uuid or exists (
        select 1 from meeting_access ma
          join users u on u.id = ma.user_id
          join meeting_access_sources source on source.meeting_id = ma.meeting_id
            and source.recipient_email = lower(u.email)
        where ma.meeting_id = m.id and ma.user_id = ${input.workspace.userId}::uuid
          and ma.revoked_at is null and source.source = 'participant' and source.revoked_at is null
      ))
      and coalesce(m.started_at, e.starts_at) <= ${windowEnd}
      and coalesce(m.ended_at, e.ends_at, m.started_at, e.starts_at) >= ${windowStart}
    order by (coalesce(m.started_at, e.starts_at) <= ${endedAt}
      and coalesce(m.ended_at, e.ends_at, m.started_at, e.starts_at) >= ${input.startedAt}) desc,
      abs(extract(epoch from (coalesce(m.started_at, e.starts_at) - ${input.startedAt}::timestamptz))), m.id
    limit 21
  `);
  const [rows] = await databaseSql.transaction((tx) => [tx.query(query.sql, query.params)]);
  const candidates = rows as UploadMeetingCandidate[];
  return { meetings: candidates.slice(0, 20), hasMore: candidates.length > 20 };
}
