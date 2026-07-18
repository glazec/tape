import { eq } from "drizzle-orm";

import { databaseSql, db } from "@/db/client";
import { calendarEvents, meetings, users } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { getMeetingShareMatchKeys } from "@/lib/meeting-sharing";

export async function applyMeetingShareRules(input: {
  attendeeEmails: unknown;
  meetingId: string;
  ownerUserId: string;
  teamId: string;
  title: string;
  workspaceDomain: string;
}) {
  const matchKeys = getMeetingShareMatchKeys(input);
  const result = await databaseSql.transaction((txn) => [
    txn`
      update meeting_access_sources as source
      set revoked_at = now(), updated_at = now()
      where source.meeting_id = ${input.meetingId}::uuid
        and source.source = 'share_policy'
        and exists (
          select 1
          from meeting_share_policies as policy
          where policy.id::text = source.source_id
            and policy.scope = 'related'
        )
    `,
    txn`
      insert into meeting_access_sources (
        meeting_id,
        recipient_email,
        role,
        source,
        source_id,
        created_by_user_id
      )
      select distinct
        ${input.meetingId}::uuid,
        policy.recipient_email,
        policy.role,
        'share_policy',
        policy.id::text,
        policy.created_by_user_id
      from meeting_share_policies as policy
      where policy.team_id = ${input.teamId}::uuid
        and policy.owner_user_id = ${input.ownerUserId}::uuid
        and policy.scope = 'related'
        and policy.revoked_at is null
        and (
          exists (
            select 1
            from meeting_share_policy_keys as email_key
            where email_key.policy_id = policy.id
              and email_key.match_key like 'participant:email:%'
              and email_key.match_key = any(${matchKeys}::text[])
          )
          or (
            exists (
              select 1
              from meeting_share_policy_keys as title_key
              where title_key.policy_id = policy.id
                and title_key.match_key like 'title:%'
                and title_key.match_key = any(${matchKeys}::text[])
            )
            and exists (
              select 1
              from meeting_share_policy_keys as domain_key
              where domain_key.policy_id = policy.id
                and domain_key.match_key like 'participant:domain:%'
                and domain_key.match_key = any(${matchKeys}::text[])
            )
          )
        )
      on conflict (meeting_id, recipient_email, source, source_id) do update
      set role = excluded.role,
          created_by_user_id = excluded.created_by_user_id,
          revoked_at = null,
          updated_at = now()
    `,
    txn`
      insert into meeting_access (
        meeting_id,
        user_id,
        role,
        source,
        source_id,
        created_by_user_id
      )
      select distinct on (source.meeting_id, app_user.id)
        source.meeting_id,
        app_user.id,
        source.role,
        'effective',
        'materialized',
        source.created_by_user_id
      from meeting_access_sources as source
      join users as app_user on lower(app_user.email) = source.recipient_email
      where source.meeting_id = ${input.meetingId}::uuid
        and source.revoked_at is null
        and app_user.id <> ${input.ownerUserId}::uuid
      order by source.meeting_id, app_user.id, source.created_at
      on conflict (meeting_id, user_id) do update
      set role = excluded.role,
          source = 'effective',
          source_id = 'materialized',
          created_by_user_id = excluded.created_by_user_id,
          revoked_at = null,
          updated_at = now()
    `,
    txn`
      insert into meeting_share_invites (
        meeting_id,
        email,
        role,
        created_by_user_id,
        source,
        source_id
      )
      select distinct on (source.meeting_id, source.recipient_email)
        source.meeting_id,
        source.recipient_email,
        source.role,
        source.created_by_user_id,
        'effective',
        'materialized'
      from meeting_access_sources as source
      where source.meeting_id = ${input.meetingId}::uuid
        and source.revoked_at is null
        and not exists (
          select 1 from users where lower(users.email) = source.recipient_email
        )
      order by source.meeting_id, source.recipient_email, source.created_at
      on conflict (meeting_id, email) do update
      set role = excluded.role,
          created_by_user_id = excluded.created_by_user_id,
          source = 'effective',
          source_id = 'materialized',
          accepted_at = null,
          revoked_at = null,
          updated_at = now()
    `,
    txn`
      update meeting_access as access
      set revoked_at = now(), updated_at = now()
      from users as app_user
      where access.meeting_id = ${input.meetingId}::uuid
        and access.user_id = app_user.id
        and not exists (
          select 1
          from meeting_access_sources as source
          where source.meeting_id = access.meeting_id
            and source.recipient_email = lower(app_user.email)
            and source.revoked_at is null
        )
    `,
    txn`
      update meeting_share_invites as invite
      set revoked_at = now(), updated_at = now()
      where invite.meeting_id = ${input.meetingId}::uuid
        and not exists (
          select 1
          from meeting_access_sources as source
          where source.meeting_id = invite.meeting_id
            and source.recipient_email = lower(invite.email)
            and source.revoked_at is null
        )
    `,
    txn`
      select count(distinct policy.id)::integer as shared_count
      from meeting_share_policies as policy
      join meeting_access_sources as source
        on source.source = 'share_policy'
        and source.source_id = policy.id::text
      where source.meeting_id = ${input.meetingId}::uuid
        and source.revoked_at is null
        and policy.scope = 'related'
        and policy.revoked_at is null
    `,
  ]);
  const rows = result.at(-1) as Array<{ shared_count?: number }> | undefined;

  return { sharedCount: rows?.[0]?.shared_count ?? 0 };
}

export async function reconcileMeetingSharingForMeeting(meetingId: string) {
  const [meeting] = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      id: meetings.id,
      ownerEmail: users.email,
      ownerUserId: meetings.ownerUserId,
      teamId: meetings.teamId,
      title: meetings.title,
    })
    .from(meetings)
    .innerJoin(users, eq(users.id, meetings.ownerUserId))
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(eq(meetings.id, meetingId))
    .limit(1);

  if (!meeting) {
    return { sharedCount: 0 };
  }

  const workspaceDomain = normalizeEmailDomain(meeting.ownerEmail);

  if (!workspaceDomain) {
    return { sharedCount: 0 };
  }

  return applyMeetingShareRules({
    attendeeEmails: meeting.attendeeEmails,
    meetingId: meeting.id,
    ownerUserId: meeting.ownerUserId,
    teamId: meeting.teamId,
    title: meeting.title,
    workspaceDomain,
  });
}
