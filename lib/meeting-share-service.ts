import { and, asc, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  meetingAccessSources,
  meetingSharePolicies,
  users,
} from "@/db/schema";

export type MeetingShareScope = "single" | "related";

export type ActiveMeetingShare = {
  email: string;
  id: string;
  pending: boolean;
  scope: MeetingShareScope;
};

export async function createMeetingSharePolicy(input: {
  createdByUserId: string;
  matchKeys: string[];
  meetingIds: string[];
  ownerUserId: string;
  recipientEmail: string;
  scope: MeetingShareScope;
  seedMeetingId: string;
  teamId: string;
}) {
  const policyId = crypto.randomUUID();
  const result = await db.execute<{ id: string; pending: boolean }>(sql`
    with active_policy as (
      insert into meeting_share_policies (
        id,
        team_id,
        owner_user_id,
        seed_meeting_id,
        recipient_email,
        scope,
        role,
        created_by_user_id
      ) values (
        ${policyId}::uuid,
        ${input.teamId}::uuid,
        ${input.ownerUserId}::uuid,
        ${input.seedMeetingId}::uuid,
        ${input.recipientEmail},
        ${input.scope},
        'shared',
        ${input.createdByUserId}::uuid
      )
      on conflict (
        team_id,
        owner_user_id,
        seed_meeting_id,
        recipient_email,
        scope
      ) where revoked_at is null do update
      set role = excluded.role,
          created_by_user_id = excluded.created_by_user_id,
          updated_at = now()
      returning id
    ), new_keys as (
      insert into meeting_share_policy_keys (policy_id, match_key)
      select active_policy.id, key
      from active_policy
      cross join unnest(${input.matchKeys}::text[]) as key
      on conflict (policy_id, match_key) do nothing
    ), new_sources as (
      insert into meeting_access_sources (
        meeting_id,
        recipient_email,
        role,
        source,
        source_id,
        created_by_user_id
      )
      select
        meeting_id,
        ${input.recipientEmail},
        'shared',
        'share_policy',
        active_policy.id::text,
        ${input.createdByUserId}::uuid
      from active_policy
      cross join unnest(${input.meetingIds}::uuid[]) as meeting_id
      on conflict (meeting_id, recipient_email, source, source_id) do update
      set role = excluded.role,
          created_by_user_id = excluded.created_by_user_id,
          revoked_at = null,
          updated_at = now()
    ), access_grants as (
      insert into meeting_access (
        meeting_id,
        user_id,
        role,
        source,
        source_id,
        created_by_user_id
      )
      select
        meeting_id,
        app_user.id,
        'shared',
        'effective',
        'materialized',
        ${input.createdByUserId}::uuid
      from unnest(${input.meetingIds}::uuid[]) as meeting_id
      join users as app_user on lower(app_user.email) = ${input.recipientEmail}
      on conflict (meeting_id, user_id) do update
      set role = excluded.role,
          source = 'effective',
          source_id = 'materialized',
          created_by_user_id = excluded.created_by_user_id,
          revoked_at = null,
          updated_at = now()
    ), invite_grants as (
      insert into meeting_share_invites (
        meeting_id,
        email,
        role,
        created_by_user_id,
        source,
        source_id
      )
      select
        meeting_id,
        ${input.recipientEmail},
        'shared',
        ${input.createdByUserId}::uuid,
        'effective',
        'materialized'
      from unnest(${input.meetingIds}::uuid[]) as meeting_id
      where not exists (
        select 1 from users where lower(email) = ${input.recipientEmail}
      )
      on conflict (meeting_id, email) do update
      set role = excluded.role,
          created_by_user_id = excluded.created_by_user_id,
          source = 'effective',
          source_id = 'materialized',
          accepted_at = null,
          revoked_at = null,
          updated_at = now()
    )
    select
      active_policy.id,
      not exists (
        select 1 from users where lower(email) = ${input.recipientEmail}
      ) as pending
    from active_policy
  `);

  return {
    id: result.rows[0]?.id ?? policyId,
    pending: result.rows[0]?.pending ?? true,
  };
}

export async function listActiveMeetingShares(
  meetingId: string,
): Promise<ActiveMeetingShare[]> {
  const rows = await db
    .select({
      email: meetingSharePolicies.recipientEmail,
      id: meetingSharePolicies.id,
      scope: meetingSharePolicies.scope,
      userId: users.id,
    })
    .from(meetingSharePolicies)
    .leftJoin(users, eq(users.email, meetingSharePolicies.recipientEmail))
    .where(
      and(
        isNull(meetingSharePolicies.revokedAt),
        or(
          eq(meetingSharePolicies.seedMeetingId, meetingId),
          sql`exists (
            select 1
            from ${meetingAccessSources}
            where ${meetingAccessSources.meetingId} = ${meetingId}::uuid
              and ${meetingAccessSources.source} = 'share_policy'
              and ${meetingAccessSources.sourceId} = ${meetingSharePolicies.id}::text
              and ${meetingAccessSources.revokedAt} is null
          )`,
        ),
      ),
    )
    .orderBy(asc(meetingSharePolicies.recipientEmail));

  return rows.flatMap((row) =>
    row.scope === "single" || row.scope === "related"
      ? [
          {
            email: row.email,
            id: row.id,
            pending: row.userId === null,
            scope: row.scope,
          },
        ]
      : [],
  );
}

export async function meetingSharePolicyAppliesToMeeting(
  policyId: string,
  meetingId: string,
) {
  const [row] = await db
    .select({ id: meetingSharePolicies.id })
    .from(meetingSharePolicies)
    .where(
      and(
        eq(meetingSharePolicies.id, policyId),
        isNull(meetingSharePolicies.revokedAt),
        or(
          eq(meetingSharePolicies.seedMeetingId, meetingId),
          sql`exists (
            select 1
            from ${meetingAccessSources}
            where ${meetingAccessSources.meetingId} = ${meetingId}::uuid
              and ${meetingAccessSources.sourceId} = ${meetingSharePolicies.id}::text
              and ${meetingAccessSources.revokedAt} is null
          )`,
        ),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function revokeMeetingSharePolicy(policyId: string) {
  await db.execute(sql`
    with revoked_policy as (
      update meeting_share_policies
      set revoked_at = now(), updated_at = now()
      where id = ${policyId}::uuid and revoked_at is null
      returning id
    ), affected as (
      update meeting_access_sources
      set revoked_at = now(), updated_at = now()
      where source = 'share_policy'
        and source_id = ${policyId}
        and revoked_at is null
      returning meeting_id, recipient_email
    ), revoked_access as (
      update meeting_access as access
      set revoked_at = now(), updated_at = now()
      from affected
      join users as app_user
        on lower(app_user.email) = affected.recipient_email
      where access.meeting_id = affected.meeting_id
        and access.user_id = app_user.id
        and not exists (
          select 1
          from meeting_access_sources as remaining
          where remaining.meeting_id = affected.meeting_id
            and remaining.recipient_email = affected.recipient_email
            and remaining.revoked_at is null
            and not (
              remaining.source = 'share_policy'
              and remaining.source_id = ${policyId}
            )
        )
    )
    update meeting_share_invites as invite
    set revoked_at = now(), updated_at = now()
    from affected
    where invite.meeting_id = affected.meeting_id
      and lower(invite.email) = affected.recipient_email
      and not exists (
        select 1
        from meeting_access_sources as remaining
        where remaining.meeting_id = affected.meeting_id
          and remaining.recipient_email = affected.recipient_email
          and remaining.revoked_at is null
          and not (
            remaining.source = 'share_policy'
            and remaining.source_id = ${policyId}
          )
      )
  `);
}

export async function revokeMeetingSharesSeededByMeeting(meetingId: string) {
  await db.execute(sql`
    with revoked_policies as (
      update meeting_share_policies
      set revoked_at = now(), updated_at = now()
      where seed_meeting_id = ${meetingId}::uuid and revoked_at is null
      returning id
    ), affected as (
      update meeting_access_sources
      set revoked_at = now(), updated_at = now()
      where source = 'share_policy'
        and source_id in (select id::text from revoked_policies)
        and revoked_at is null
      returning meeting_id, recipient_email
    ), revoked_access as (
      update meeting_access as access
      set revoked_at = now(), updated_at = now()
      from affected
      join users as app_user
        on lower(app_user.email) = affected.recipient_email
      where access.meeting_id = affected.meeting_id
        and access.user_id = app_user.id
        and not exists (
          select 1
          from meeting_access_sources as remaining
          where remaining.meeting_id = affected.meeting_id
            and remaining.recipient_email = affected.recipient_email
            and remaining.revoked_at is null
            and remaining.source_id not in (
              select id::text from revoked_policies
            )
        )
    )
    update meeting_share_invites as invite
    set revoked_at = now(), updated_at = now()
    from affected
    where invite.meeting_id = affected.meeting_id
      and lower(invite.email) = affected.recipient_email
      and not exists (
        select 1
        from meeting_access_sources as remaining
        where remaining.meeting_id = affected.meeting_id
          and remaining.recipient_email = affected.recipient_email
          and remaining.revoked_at is null
          and remaining.source_id not in (
            select id::text from revoked_policies
          )
      )
  `);
}
