import { sql } from "drizzle-orm";

import { databaseSql, db } from "@/db/client";
import { normalizeEmail } from "@/lib/access";

export type MeetingAccessGrantSource =
  | "manual"
  | "participant"
  | "related_rule"
  | "share_policy";

export async function grantMeetingAccessByEmail(input: {
  createdByUserId: string;
  email: string;
  meetingId: string;
  role: "attendee" | "shared";
  source: MeetingAccessGrantSource;
  sourceId: string;
}) {
  const email = normalizeEmail(input.email);
  const result = await db.execute<{
    email: string;
    id: string | null;
    name: string | null;
    pending: boolean;
  }>(sql`
    with target_user as materialized (
      select id, email, name
      from users
      where lower(email) = ${email}
      limit 1
    ), source_grant as (
      insert into meeting_access_sources (
        meeting_id,
        recipient_email,
        role,
        source,
        source_id,
        created_by_user_id
      ) values (
        ${input.meetingId}::uuid,
        ${email},
        ${input.role}::access_role,
        ${input.source},
        ${input.sourceId},
        ${input.createdByUserId}::uuid
      )
      on conflict (meeting_id, recipient_email, source, source_id) do update
      set role = excluded.role,
          created_by_user_id = excluded.created_by_user_id,
          revoked_at = null,
          updated_at = now()
    ), access_grant as (
      insert into meeting_access (
        meeting_id,
        user_id,
        role,
        source,
        source_id,
        created_by_user_id
      )
      select
        ${input.meetingId}::uuid,
        target_user.id,
        ${input.role}::access_role,
        'effective',
        'materialized',
        ${input.createdByUserId}::uuid
      from target_user
      where not (
        ${input.source} = 'participant'
        and target_user.id = ${input.createdByUserId}::uuid
      )
      on conflict (meeting_id, user_id) do update
      set role = excluded.role,
          source = 'effective',
          source_id = 'materialized',
          created_by_user_id = excluded.created_by_user_id,
          revoked_at = null,
          updated_at = now()
    ), invite_grant as (
      insert into meeting_share_invites (
        meeting_id,
        email,
        role,
        created_by_user_id,
        source,
        source_id
      )
      select
        ${input.meetingId}::uuid,
        ${email},
        ${input.role}::access_role,
        ${input.createdByUserId}::uuid,
        'effective',
        'materialized'
      where not exists (select 1 from target_user)
      on conflict (meeting_id, email) do update
      set role = excluded.role,
          created_by_user_id = excluded.created_by_user_id,
          source = 'effective',
          source_id = 'materialized',
          accepted_at = null,
          revoked_at = null,
          updated_at = now()
    )
    select email, id, name, false as pending from target_user
    union all
    select ${email}, null, null, true
    where not exists (select 1 from target_user)
  `);
  const row = result.rows[0];

  return row?.pending
    ? { email, pending: true as const }
    : {
        pending: false as const,
        user: {
          email: row?.email ?? email,
          id: row?.id ?? input.createdByUserId,
          name: row?.name ?? null,
        },
      };
}

export async function reconcileEffectiveMeetingAccess(
  meetingId: string,
  ownerUserId: string,
) {
  await databaseSql.transaction((txn) => [
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
      where source.meeting_id = ${meetingId}::uuid
        and source.revoked_at is null
        and app_user.id <> ${ownerUserId}::uuid
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
      where source.meeting_id = ${meetingId}::uuid
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
      where access.meeting_id = ${meetingId}::uuid
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
      where invite.meeting_id = ${meetingId}::uuid
        and not exists (
          select 1
          from meeting_access_sources as source
          where source.meeting_id = invite.meeting_id
            and source.recipient_email = lower(invite.email)
            and source.revoked_at is null
        )
    `,
  ]);
}
