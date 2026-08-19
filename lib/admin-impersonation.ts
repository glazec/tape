import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { teamMemberships, teams, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";

export type AdminImpersonationTarget = {
  id: string;
  authUserId: string;
  email: string;
  name: string | null;
  role?: string | null;
  teamName?: string | null;
};

export async function getAdminImpersonationTarget(
  userId: string,
): Promise<AdminImpersonationTarget | null> {
  const [target] = await db
    .select({
      authUserId: users.authUserId,
      email: users.email,
      id: users.id,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return target ?? null;
}

export async function getImpersonatedSessionUser(
  userId: string,
): Promise<SessionUser | null> {
  const target = await getAdminImpersonationTarget(userId);

  if (!target) {
    return null;
  }

  return {
    email: target.email,
    id: target.authUserId,
    name: target.name,
  };
}

export async function listAdminImpersonationTargets() {
  return db
    .select({
      authUserId: users.authUserId,
      email: users.email,
      id: users.id,
      name: users.name,
      role: teamMemberships.role,
      teamName: teams.name,
    })
    .from(users)
    .leftJoin(teamMemberships, eq(teamMemberships.userId, users.id))
    .leftJoin(teams, eq(teams.id, teamMemberships.teamId))
    .orderBy(asc(users.email))
    .limit(200);
}

export async function recordAdminImpersonationAudit(input: {
  action: "admin_impersonation_cleared" | "admin_impersonation_started";
  actorAuthUserId: string;
  targetUserId: string;
}) {
  await db.execute(sql`
    insert into audit_events (
      team_id,
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata,
      created_at
    )
    select
      target_membership.team_id,
      actor.id,
      ${input.action},
      'user',
      target.id::text,
      jsonb_build_object('actorAuthUserId', ${input.actorAuthUserId}::text),
      now()
    from users target
    join lateral (
      select membership.team_id
      from team_memberships membership
      where membership.user_id = target.id
      order by membership.created_at asc, membership.id asc
      limit 1
    ) target_membership on true
    left join users actor on actor.auth_user_id = ${input.actorAuthUserId}
    where target.id = ${input.targetUserId}::uuid
  `);
}
