import { createHash, randomBytes } from "node:crypto";

import { databaseSql } from "@/db/client";
import type { WorkspaceContext } from "@/lib/workspace";

export class LocalRecorderTargetError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
    this.name = "LocalRecorderTargetError";
  }
}

export type RecordingMeeting = {
  meetingId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  createdAt: string;
  unavailableReason: string | null;
};

type RecordingTarget = {
  meetingId: string;
  meetingTitle: string;
  startsAt: string | null;
  endsAt: string | null;
};

export async function listLocalRecorderRecordingMeetings(input: {
  workspace: WorkspaceContext;
  query?: string;
  offset?: number;
}) {
  if (input.workspace.canCreateMeetings === false) {
    return { meetings: [], hasMore: false };
  }
  const search = (input.query ?? "").trim();
  const rows = await databaseSql`
    select m.id as "meetingId", m.title, m.started_at as "startsAt",
      m.ended_at as "endsAt", m.status, m.created_at as "createdAt",
      case when m.status = 'recording' and m.recall_bot_id is not null then 'Meeting bot is recording'
        when exists (select 1 from local_recording_attempts a where a.meeting_id = m.id
          and (a.attempt_state = 'started' and a.expires_at > now()
            or a.attempt_state = 'uploading'
            or a.attempt_state = 'uploaded' and not exists (
              select 1 from local_recordings r where r.local_recording_attempt_id = a.id
            ))) then 'Another recording is using this meeting'
        else null end as "unavailableReason"
    from meetings m
    where m.team_id = ${input.workspace.teamId}::uuid
      and m.status <> 'cancelled'
      and (m.owner_user_id = ${input.workspace.userId}::uuid or exists (
        select 1 from team_memberships membership
        where membership.team_id = m.team_id
          and membership.user_id = ${input.workspace.userId}::uuid
          and membership.role in ('owner', 'admin')
      ))
      and (${search} = '' or strpos(lower(m.title), lower(${search})) > 0)
    order by abs(extract(epoch from (coalesce(m.started_at, m.created_at) - now()))), m.id
    limit 101 offset ${input.offset ?? 0}
  ` as RecordingMeeting[];
  return { meetings: rows.slice(0, 100), hasMore: rows.length > 100 };
}

export async function setLocalRecorderRecordingTarget(input: {
  deviceId: string;
  fallbackIntentId?: string;
  clientRequestId?: string;
  meetingId?: string;
  title?: string;
  now: Date;
  workspace: WorkspaceContext;
}) {
  if (input.workspace.canCreateMeetings === false) {
    throw new LocalRecorderTargetError("Shared users cannot add meetings", 403);
  }
  const fallbackIntentId = input.fallbackIntentId ?? (input.clientRequestId
    ? hash(`recording-start:${input.workspace.teamId}:${input.workspace.userId}:${input.deviceId}:${input.clientRequestId}`)
    : randomBytes(18).toString("base64url"));
  const tokenHash = hash(fallbackIntentId);
  const deviceHash = hash(input.deviceId);
  const expiresAt = new Date(input.now.getTime() + 6 * 60 * 60 * 1000);
  try {
    // The device lock serializes starts even when they target different meetings.
    // Each statement after the lock receives a fresh READ COMMITTED snapshot.
    const results = await databaseSql.transaction((tx) => [
      tx`select pg_advisory_xact_lock(hashtextextended(${`${input.workspace.userId}:${deviceHash}`}, 0))`,
      tx`update local_recording_attempts a set
          attempt_state = case when a.attempt_state = 'started' then 'sealed' else 'completed' end,
          updated_at = ${input.now}
        where ((a.attempt_state = 'uploaded' and exists (select 1 from local_recordings r where r.local_recording_attempt_id = a.id))
          or (a.attempt_state = 'started' and a.expires_at <= ${input.now}))
          and (a.meeting_id = ${input.meetingId ?? null}::uuid
            or (a.user_id = ${input.workspace.userId}::uuid and a.device_id_hash = ${deviceHash}))
          and a.meeting_id in (
            select m.id from meetings m where m.team_id = ${input.workspace.teamId}::uuid
              and (m.owner_user_id = ${input.workspace.userId}::uuid or exists (
                select 1 from team_memberships membership where membership.team_id = m.team_id
                  and membership.user_id = ${input.workspace.userId}::uuid and membership.role in ('owner', 'admin')
              ))
          )`,
      tx`
        with replayed as materialized (
          select m.* from local_recording_attempts a
          join meetings m on m.id = a.meeting_id
          where ${Boolean(input.clientRequestId && !input.fallbackIntentId)}
            and a.fallback_intent_id_hash = ${tokenHash}
            and a.user_id = ${input.workspace.userId}::uuid and a.device_id_hash = ${deviceHash}
            and a.attempt_state = 'started' and a.expires_at > ${input.now}
            and m.team_id = ${input.workspace.teamId}::uuid and m.status <> 'cancelled'
            and (m.owner_user_id = ${input.workspace.userId}::uuid or exists (
              select 1 from team_memberships membership where membership.team_id = m.team_id
                and membership.user_id = ${input.workspace.userId}::uuid and membership.role in ('owner', 'admin')
            ))
            and (m.id = ${input.meetingId ?? null}::uuid
              or (${input.meetingId ?? null}::uuid is null and m.platform = 'in_person'
                and m.title = ${input.title?.trim() || "Manual recording"}))
        ), active_attempt as materialized (
          select a.id from local_recording_attempts a
          join meetings original on original.id = a.meeting_id
          where ${Boolean(input.fallbackIntentId)}
            and a.fallback_intent_id_hash = ${tokenHash}
            and a.user_id = ${input.workspace.userId}::uuid
            and a.device_id_hash = ${deviceHash}
            and original.team_id = ${input.workspace.teamId}::uuid
            and a.attempt_state = 'started'
            and a.expires_at > ${input.now}
          for update of a
        ), permission as materialized (
          select 1 where (
            (${Boolean(input.fallbackIntentId)} and exists (select 1 from active_attempt))
            or (not ${Boolean(input.fallbackIntentId)}
              and not exists (select 1 from local_recording_attempts where fallback_intent_id_hash = ${tokenHash})
              and not exists (
              select 1 from local_recording_attempts
              where user_id = ${input.workspace.userId}::uuid and device_id_hash = ${deviceHash}
                and attempt_state in ('started', 'uploading', 'uploaded')
            ))
          ) and exists (
            select 1 from team_memberships where team_id = ${input.workspace.teamId}::uuid
              and user_id = ${input.workspace.userId}::uuid
          )
        ), existing_target as materialized (
          select m.* from meetings m, permission
          where m.id = ${input.meetingId ?? null}::uuid
            and m.team_id = ${input.workspace.teamId}::uuid
            and m.status <> 'cancelled'
            and not (m.status = 'recording' and m.recall_bot_id is not null)
            and (m.owner_user_id = ${input.workspace.userId}::uuid or exists (
              select 1 from team_memberships membership
              where membership.team_id = m.team_id and membership.user_id = ${input.workspace.userId}::uuid
                and membership.role in ('owner', 'admin')
            ))
            and not exists (
              select 1 from local_recording_attempts other where other.meeting_id = m.id
                and other.attempt_state in ('started', 'uploading', 'uploaded')
                and other.id not in (select id from active_attempt)
            )
        ), new_target as (
          insert into meetings (team_id, owner_user_id, platform, status, title, started_at)
          select ${input.workspace.teamId}::uuid, ${input.workspace.userId}::uuid,
            'in_person', 'scheduled', ${input.title?.trim() || "Manual recording"}, null
          from permission where ${input.meetingId ?? null}::uuid is null
          returning *
        ), target as materialized (
          select * from existing_target union all select * from new_target
        ), switched as (
          update local_recording_attempts a set meeting_id = target.id, updated_at = ${input.now}
          from target, active_attempt
          where a.id = active_attempt.id and a.attempt_state = 'started'
          returning a.meeting_id
        ), started as (
          insert into local_recording_attempts
            (meeting_id, user_id, device_id_hash, fallback_intent_id_hash,
             attempt_state, claimed_at, expires_at, notification_state)
          select target.id, ${input.workspace.userId}::uuid, ${deviceHash}, ${tokenHash},
            'started', ${input.now}, ${expiresAt}, 'manual'
          from target where not ${Boolean(input.fallbackIntentId)}
          returning meeting_id
        )
        select target.id as "meetingId", target.title as "meetingTitle",
          target.started_at as "startsAt", target.ended_at as "endsAt"
        from target where target.id in (select meeting_id from switched union all select meeting_id from started)
        union all
        select replayed.id as "meetingId", replayed.title as "meetingTitle",
          replayed.started_at as "startsAt", replayed.ended_at as "endsAt" from replayed
      `,
    ]);
    const [target] = results[2] as RecordingTarget[];
    if (!target) {
      throw new LocalRecorderTargetError("Recording target unavailable or capture already stopped");
    }
    return { ...target, fallbackIntentId };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      throw new LocalRecorderTargetError("Another recording is already using this meeting");
    }
    throw error;
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export async function finishLocalRecorderRecordingTarget(input: {
  deviceId: string;
  fallbackIntentId: string;
  workspace: WorkspaceContext;
}) {
  const rows = await databaseSql`
    with frozen as (
      update local_recording_attempts a set
        attempt_state = case when a.attempt_state = 'started' then 'sealed' else a.attempt_state end,
        updated_at = now()
      from meetings m
      where a.meeting_id = m.id and m.team_id = ${input.workspace.teamId}::uuid
        and a.user_id = ${input.workspace.userId}::uuid
        and a.device_id_hash = ${hash(input.deviceId)}
        and a.fallback_intent_id_hash = ${hash(input.fallbackIntentId)}
        and a.attempt_state in ('started', 'sealed', 'uploading', 'uploaded', 'completed')
      returning a.meeting_id
    )
    select m.id as "meetingId", m.title as "meetingTitle", m.started_at as "startsAt", m.ended_at as "endsAt"
    from meetings m join frozen on frozen.meeting_id = m.id
  ` as RecordingTarget[];
  if (!rows[0]) throw new LocalRecorderTargetError("Recording target unavailable");
  return { ...rows[0], fallbackIntentId: input.fallbackIntentId };
}

export async function getLocalRecorderRecordingTargetStatus(input: {
  deviceId: string;
  fallbackIntentId: string;
  workspace: WorkspaceContext;
}) {
  const [attempt] = await databaseSql`
    select a.attempt_state as state from local_recording_attempts a
    join meetings m on m.id = a.meeting_id
    where m.team_id = ${input.workspace.teamId}::uuid
      and a.user_id = ${input.workspace.userId}::uuid
      and a.device_id_hash = ${hash(input.deviceId)}
      and a.fallback_intent_id_hash = ${hash(input.fallbackIntentId)}
    limit 1
  ` as Array<{ state: string }>;
  if (!attempt) throw new LocalRecorderTargetError("Recording target unavailable", 404);
  return attempt;
}
