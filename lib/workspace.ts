import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  allowedDomains,
  meetingAccess,
  meetings,
  teamMemberships,
  teams,
  users,
} from "@/db/schema";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import type { SessionUser } from "@/lib/auth";
import { normalizeEmail, normalizeEmailDomain } from "@/lib/access";

export type WorkspaceContext = {
  userId: string;
  teamId: string;
  domain: string;
  canCreateMeetings?: boolean;
};

export type WorkspaceMember = {
  email: string;
  id: string;
  isCurrentUser: boolean;
  joinedAt: Date;
  name: string | null;
  role: string;
};

export async function getOrCreateWorkspaceForSessionUser(
  sessionUser: SessionUser,
): Promise<WorkspaceContext> {
  const email = normalizeEmail(sessionUser.email);
  const domain = normalizeEmailDomain(email);

  if (!domain) {
    throw new Error("Session user email must include a domain");
  }

  const [userId, existingDomain] = await Promise.all([
    getOrCreateUserId(sessionUser, email),
    db
      .select({ teamId: allowedDomains.teamId })
      .from(allowedDomains)
      .where(eq(allowedDomains.domain, domain))
      .limit(1),
  ]);

  if (existingDomain[0]) {
    await db
      .insert(teamMemberships)
      .values({
        teamId: existingDomain[0].teamId,
        userId,
        role: "member",
      })
      .onConflictDoNothing({
        target: [teamMemberships.teamId, teamMemberships.userId],
      });

    return {
      canCreateMeetings: true,
      domain,
      teamId: existingDomain[0].teamId,
      userId,
    };
  }

  const existingMembership = await db
    .select({ role: teamMemberships.role, teamId: teamMemberships.teamId })
    .from(teamMemberships)
    .where(eq(teamMemberships.userId, userId))
    .limit(1);

  if (existingMembership[0]) {
    return {
      canCreateMeetings: existingMembership[0].role !== "external",
      domain,
      teamId: existingMembership[0].teamId,
      userId,
    };
  }

  const existingAllowedDomain = await db
    .select({ id: allowedDomains.id })
    .from(allowedDomains)
    .limit(1);
  const shouldBootstrapInternalWorkspace = existingAllowedDomain.length === 0;
  const [team] = await db
    .insert(teams)
    .values({
      name: shouldBootstrapInternalWorkspace
        ? `${domain} workspace`
        : `${domain} guest workspace`,
    })
    .returning({ id: teams.id });

  if (shouldBootstrapInternalWorkspace) {
    await db.insert(allowedDomains).values({ teamId: team.id, domain });
  }

  await db
    .insert(teamMemberships)
    .values({
      teamId: team.id,
      userId,
      role: shouldBootstrapInternalWorkspace ? "admin" : "external",
    })
    .onConflictDoNothing({
      target: [teamMemberships.teamId, teamMemberships.userId],
    });

  return {
    canCreateMeetings: shouldBootstrapInternalWorkspace,
    domain,
    teamId: team.id,
    userId,
  };
}

export async function getWorkspaceAccessSummary(workspace: WorkspaceContext) {
  const [workspaceMeetings, externalShares] = await Promise.all([
    db
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.teamId, workspace.teamId))
      .limit(1),
    db
      .select({ id: meetingAccess.id })
      .from(meetingAccess)
      .innerJoin(meetings, eq(meetingAccess.meetingId, meetings.id))
      .where(
        and(
          eq(meetingAccess.userId, workspace.userId),
          sql`${meetings.teamId} <> ${workspace.teamId}`,
        ),
      )
      .limit(1),
  ]);

  const hasWorkspaceMeetings = workspaceMeetings.length > 0;
  const hasExternalShares = externalShares.length > 0;

  const canCreateMeetings = workspace.canCreateMeetings !== false;

  return {
    canCreateMeetings,
    hasExternalShares,
    hasWorkspaceMeetings,
    isSharedOnly: !canCreateMeetings,
  };
}

export async function listWorkspaceMembers(
  workspace: WorkspaceContext,
): Promise<WorkspaceMember[]> {
  const members = await db
    .select({
      email: users.email,
      id: users.id,
      joinedAt: teamMemberships.createdAt,
      name: users.name,
      role: teamMemberships.role,
    })
    .from(teamMemberships)
    .innerJoin(users, eq(teamMemberships.userId, users.id))
    .where(eq(teamMemberships.teamId, workspace.teamId))
    .orderBy(asc(users.email));

  return members.map((member) => ({
    ...member,
    isCurrentUser: member.id === workspace.userId,
  }));
}

export async function assertCanCreateMeetings(workspace: WorkspaceContext) {
  const accessSummary = await getWorkspaceAccessSummary(workspace);

  if (!accessSummary.canCreateMeetings) {
    throw new SharedOnlyAccessError();
  }
}

export async function canManageTeamSettings(workspace: WorkspaceContext) {
  const [membership] = await db
    .select({ role: teamMemberships.role })
    .from(teamMemberships)
    .where(
      and(
        eq(teamMemberships.teamId, workspace.teamId),
        eq(teamMemberships.userId, workspace.userId),
      ),
    )
    .limit(1);

  return membership?.role === "admin" || membership?.role === "owner";
}

async function getOrCreateUserId(sessionUser: SessionUser, email: string) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.authUserId, sessionUser.id))
    .limit(1);

  if (existing[0]) {
    await db
      .update(users)
      .set({
        email,
        name: sessionUser.name,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));

    await grantPendingMeetingShares(existing[0].id, email);

    return existing[0].id;
  }

  const [user] = await db
    .insert(users)
    .values({
      authUserId: sessionUser.id,
      email,
      name: sessionUser.name,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        authUserId: sessionUser.id,
        name: sessionUser.name,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });

  await grantPendingMeetingShares(user.id, email);

  return user.id;
}

export async function grantPendingMeetingShares(userId: string, email: string) {
  await db.execute(sql`
    with pending as materialized (
      select id, meeting_id, role, created_by_user_id
      from meeting_share_invites
      where email = ${email}
        and accepted_at is null
        and revoked_at is null
    ), granted as (
      insert into meeting_access (
        meeting_id,
        user_id,
        role,
        source,
        source_id,
        created_by_user_id
      )
      select
        pending.meeting_id,
        ${userId}::uuid,
        pending.role,
        'effective',
        'materialized',
        pending.created_by_user_id
      from pending
      on conflict (meeting_id, user_id) do update
      set role = excluded.role,
          source = 'effective',
          source_id = 'materialized',
          created_by_user_id = excluded.created_by_user_id,
          revoked_at = null,
          updated_at = now()
    )
    update meeting_share_invites
    set accepted_at = now(), updated_at = now()
    where id in (select id from pending)
  `);
}
