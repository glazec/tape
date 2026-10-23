import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { setDatabaseWorkspace, withVerifiedCalendarEmail } from "@/db/rls-context";
import { allowedDomains, teamMemberships, teams } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import type { WorkspaceContext } from "@/lib/workspace";

export async function listOrganizationWorkspaces(workspace: WorkspaceContext) {
  return db.select({
    teamId: teams.id,
    teamName: teams.name,
    creditLimitUsdMicros: teams.creditLimitUsdMicros,
    role: teamMemberships.role,
    domain: sql<string>`coalesce((select domain from allowed_domains where team_id = ${teams.id} order by domain limit 1), ${workspace.domain})`,
  }).from(teamMemberships)
    .innerJoin(teams, eq(teams.id, teamMemberships.teamId))
    .where(and(eq(teamMemberships.userId, workspace.userId), sql`${teamMemberships.role} <> 'external'`))
    .orderBy(asc(teams.name));
}

export async function selectOrganizationWorkspace(workspace: WorkspaceContext, teamId: string) {
  if (teamId === workspace.teamId) return workspace;
  const organizations = await listOrganizationWorkspaces(workspace);
  const organization = organizations.find((candidate) => candidate.teamId === teamId);
  if (!organization) return null;
  const selected = { ...workspace, ...organization, canCreateMeetings: true };
  setDatabaseWorkspace(selected);
  return selected;
}

// Call only after Google has verified the account's email using its access token.
export async function workspaceForVerifiedCalendarEmail(workspace: WorkspaceContext, email: string) {
  const selected = await withVerifiedCalendarEmail(email, async () => {
    const domain = normalizeEmailDomain(email);
    const [organization] = await db.select({
      teamId: teams.id, teamName: teams.name, creditLimitUsdMicros: teams.creditLimitUsdMicros,
    }).from(allowedDomains).innerJoin(teams, eq(teams.id, allowedDomains.teamId))
      .where(eq(allowedDomains.domain, domain)).limit(1);
    if (!organization) return workspace;
    await db.insert(teamMemberships).values({
      teamId: organization.teamId, userId: workspace.userId, role: "member",
    }).onConflictDoNothing({ target: [teamMemberships.teamId, teamMemberships.userId] });
    return { ...workspace, ...organization, domain, canCreateMeetings: true };
  });
  setDatabaseWorkspace(selected);
  return selected;
}

export async function getOrganizationBotSettings(teamId: string) {
  const [domains, [team]] = await Promise.all([
    db.select({ domain: allowedDomains.domain }).from(allowedDomains)
      .where(eq(allowedDomains.teamId, teamId)).orderBy(asc(allowedDomains.domain)),
    db.select({ preferredBotDomain: teams.preferredBotDomain }).from(teams)
      .where(eq(teams.id, teamId)).limit(1),
  ]);
  return { domains: domains.map((item) => item.domain), preferredBotDomain: team?.preferredBotDomain ?? null };
}
