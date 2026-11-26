import { asc, eq } from "drizzle-orm";

import { db, privilegedDb } from "@/db/client";
import { calendarConnections, teams, users } from "@/db/schema";
import type { WorkspaceContext } from "@/lib/workspace";

export async function listConnectedCalendarAccounts(workspace: WorkspaceContext) {
  return db.select({
    id: calendarConnections.id,
    teamId: calendarConnections.teamId,
    teamName: teams.name,
    email: calendarConnections.accountEmail,
    connected: calendarConnections.recallCalendarId,
    status: calendarConnections.recallCalendarStatus,
  }).from(calendarConnections)
    .innerJoin(teams, eq(teams.id, calendarConnections.teamId))
    .where(eq(calendarConnections.userId, workspace.userId))
    .orderBy(asc(calendarConnections.createdAt));
}

export async function listMeetingShareOwnerEmails(ownerUserId: string) {
  // An owner's calendar identities can span workspaces.
  const rows = await privilegedDb
    .select({
      email: users.email,
      calendarEmail: calendarConnections.accountEmail,
    })
    .from(users)
    .leftJoin(calendarConnections, eq(calendarConnections.userId, users.id))
    .where(eq(users.id, ownerUserId));

  return [...new Set(rows.flatMap(({ email, calendarEmail }) =>
    calendarEmail ? [email, calendarEmail] : [email],
  ))];
}
