import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarConnections } from "@/db/schema";
import { ensureRecallManagedCalendarConnectionForWorkspace } from "@/lib/recall-calendar";
import type { SessionUser } from "@/lib/auth";
import {
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";

export type CalendarConnectionSummary = {
  connectionId?: string;
  accountEmail?: string | null;
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
  const connections = await db
    .select({
      connectionId: calendarConnections.id,
      accountEmail: calendarConnections.accountEmail,
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
      ),
    )
    .limit(10);
  const connection =
    connections.find((candidate) => candidate.recallCalendarId) ??
    connections[0];

  if (!connection?.recallCalendarId) {
    const linkedConnection =
      await ensureRecallManagedCalendarConnectionForWorkspace(workspace).catch(
        () => null,
      );

    if (!linkedConnection) {
      return disconnectedCalendarSummary();
    }

    return {
      connected: Boolean(linkedConnection.recallCalendarId),
      autoJoinEnabled: linkedConnection.autoJoinEnabled,
      recallCalendarStatus:
        "recallCalendarStatus" in linkedConnection
          ? (linkedConnection.recallCalendarStatus ?? null)
          : null,
      recallCalendarLastSyncedAt: null,
    };
  }

  return {
    ...(connection.connectionId ? { connectionId: connection.connectionId, accountEmail: connection.accountEmail } : {}),
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
