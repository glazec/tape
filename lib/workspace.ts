import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  allowedDomains,
  meetingAccess,
  meetingShareInvites,
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
      .onConflictDoUpdate({
        target: [teamMemberships.teamId, teamMemberships.userId],
        set: {
          role: "member",
          updatedAt: new Date(),
        },
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

export async function assertCanCreateMeetings(workspace: WorkspaceContext) {
  const accessSummary = await getWorkspaceAccessSummary(workspace);

  if (!accessSummary.canCreateMeetings) {
    throw new SharedOnlyAccessError();
  }
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

async function grantPendingMeetingShares(userId: string, email: string) {
  const pendingInvites = await db
    .select({
      id: meetingShareInvites.id,
      meetingId: meetingShareInvites.meetingId,
      role: meetingShareInvites.role,
    })
    .from(meetingShareInvites)
    .where(
      and(
        eq(meetingShareInvites.email, email),
        isNull(meetingShareInvites.acceptedAt),
      ),
    )
    .limit(50);

  for (const invite of pendingInvites) {
    await db
      .insert(meetingAccess)
      .values({
        meetingId: invite.meetingId,
        role: invite.role,
        userId,
      })
      .onConflictDoNothing({
        target: [meetingAccess.meetingId, meetingAccess.userId],
      });

    await db
      .update(meetingShareInvites)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(meetingShareInvites.id, invite.id));
  }
}
