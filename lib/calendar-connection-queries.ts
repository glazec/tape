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
  teamId?: string;
  accounts?: CalendarConnectionSummary[];
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
    .limit(100);
  if (connections.length > 1) {
    const accounts = connections.map((connection) => ({
      teamId: workspace.teamId,
      connectionId: connection.connectionId,
      accountEmail: connection.accountEmail,
      connected: Boolean(connection.recallCalendarId),
      autoJoinEnabled: connection.autoJoinEnabled,
      recallCalendarStatus: connection.recallCalendarStatus,
      recallCalendarLastSyncedAt: connection.recallCalendarLastSyncedAt?.toISOString() ?? null,
    }));
    return { ...disconnectedCalendarSummary(), connected: accounts.some((account) => account.connected), accounts };
  }
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
      teamId: workspace.teamId,
      connectionId: linkedConnection.id,
      accountEmail: "accountEmail" in linkedConnection ? linkedConnection.accountEmail : null,
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
    ...(connection.connectionId ? { teamId: workspace.teamId, connectionId: connection.connectionId, accountEmail: connection.accountEmail } : {}),
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
