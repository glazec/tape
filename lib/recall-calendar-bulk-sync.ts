import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarConnections, users } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { syncRecallCalendarEventsForWorkspace } from "@/lib/recall-calendar";

type SyncAllInput = {
  now?: Date;
};

type SyncFailure = {
  connectionId: string;
  error: string;
};

type ConnectedCalendarConnection = {
  connectionId: string;
  teamId: string;
  userId: string;
  userEmail: string;
  autoJoinEnabled: boolean;
};

export async function syncRecallCalendarEventsForAllConnectedUsers(
  input: SyncAllInput = {},
) {
  const connections = await listConnectedRecallCalendarConnections();
  const failures: SyncFailure[] = [];
  let syncedConnectionCount = 0;
  let syncedEventCount = 0;

  for (const connection of connections) {
    try {
      const result = await syncRecallCalendarEventsForWorkspace({
        workspace: {
          teamId: connection.teamId,
          userId: connection.userId,
          domain: normalizeEmailDomain(connection.userEmail),
        },
        autoJoinEnabled: connection.autoJoinEnabled,
        now: input.now,
      });

      syncedConnectionCount += 1;
      syncedEventCount += result.syncedEventCount;
    } catch (error) {
      failures.push({
        connectionId: connection.connectionId,
        error: getErrorMessage(error),
      });
    }
  }

  return {
    connectionCount: connections.length,
    failedConnectionCount: failures.length,
    failures,
    syncedConnectionCount,
    syncedEventCount,
  };
}

async function listConnectedRecallCalendarConnections(): Promise<
  ConnectedCalendarConnection[]
> {
  return db
    .select({
      connectionId: calendarConnections.id,
      teamId: calendarConnections.teamId,
      userId: calendarConnections.userId,
      userEmail: users.email,
      autoJoinEnabled: calendarConnections.autoJoinEnabled,
    })
    .from(calendarConnections)
    .innerJoin(users, eq(users.id, calendarConnections.userId))
    .where(
      and(
        eq(calendarConnections.provider, "google"),
        isNotNull(calendarConnections.recallCalendarId),
      ),
    );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown calendar sync error";
}
