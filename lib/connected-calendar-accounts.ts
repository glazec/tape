import { asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarConnections, teams } from "@/db/schema";
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
