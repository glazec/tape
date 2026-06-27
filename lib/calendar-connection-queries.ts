import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarConnections } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import {
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";

export type CalendarConnectionSummary = {
  connected: boolean;
  autoJoinEnabled: boolean;
  recallCalendarStatus: string | null;
  recallCalendarLastSyncedAt: string | null;
};

export async function getCalendarConnectionSummary(
  sessionUser: SessionUser,
): Promise<CalendarConnectionSummary> {
  const workspace = await getOrCreateWorkspaceForSessionUser(sessionUser);

  return getCalendarConnectionSummaryForWorkspace(workspace);
}

export async function getCalendarConnectionSummaryForWorkspace(
  workspace: WorkspaceContext,
): Promise<CalendarConnectionSummary> {
  const [connection] = await db
    .select({
      autoJoinEnabled: calendarConnections.autoJoinEnabled,
      recallCalendarId: calendarConnections.recallCalendarId,
      recallCalendarStatus: calendarConnections.recallCalendarStatus,
      recallCalendarLastSyncedAt:
        calendarConnections.recallCalendarLastSyncedAt,
    })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.teamId, workspace.teamId),
        eq(calendarConnections.userId, workspace.userId),
        eq(calendarConnections.provider, "google"),
        eq(calendarConnections.externalCalendarId, "primary"),
      ),
    )
    .limit(1);

  if (!connection) {
    return disconnectedCalendarSummary();
  }

  return {
    connected: Boolean(connection.recallCalendarId),
    autoJoinEnabled: connection.autoJoinEnabled,
    recallCalendarStatus: connection.recallCalendarStatus,
    recallCalendarLastSyncedAt:
      connection.recallCalendarLastSyncedAt?.toISOString() ?? null,
  };
}

function disconnectedCalendarSummary(): CalendarConnectionSummary {
  return {
    connected: false,
    autoJoinEnabled: false,
    recallCalendarStatus: null,
    recallCalendarLastSyncedAt: null,
  };
}
