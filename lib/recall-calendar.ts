import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { databaseSql, db } from "@/db/client";
import { calendarConnections, teams, users } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { autoJoinCalendarEvent, type SyncedCalendarEvent } from "@/lib/calendar-auto-join";
import {
  listRecallCalendars,
  listRecallCalendarEvents,
  retrieveRecallCalendar,
  updateRecallCalendar,
} from "@/lib/vendors/recall";
import type { WorkspaceContext } from "@/lib/workspace";

const recallCalendarWebhookSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("calendar.update"),
    data: z.object({
      calendar_id: z.string().min(1),
    }),
  }),
  z.object({
    event: z.literal("calendar.sync_events"),
    data: z.object({
      calendar_id: z.string().min(1),
      last_updated_ts: z.iso.datetime(),
    }),
  }),
]);

type RecallCalendarWebhook = ReturnType<typeof normalizeRecallCalendarWebhook>;

type RecallCalendarConnection = {
  id: string;
  teamId: string;
  userId: string;
  autoJoinEnabled: boolean;
  recallCalendarId?: string | null;
  recallCalendarLastSyncedAt?: Date | null;
  recallCalendarStatus?: string | null;
  workspaceDomain?: string | null;
  workspaceName?: string | null;
};

type RecallCalendarSummary = {
  id: string;
  platform: string | null;
  platformEmail: string | null;
  status: string | null;
  metadata: Record<string, string>;
};

export class RecallCalendarConnectionError extends Error {
  constructor(message = "Recall calendar is not connected") {
    super(message);
  }
}

const LEGACY_PRIMARY_CALENDAR_ID = "primary";
const RECALL_CALENDAR_REPAIR_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const RECALL_CALENDAR_CHANGE_OVERLAP_MS = 5 * 60 * 1000;

export function normalizeRecallCalendarWebhook(payload: unknown) {
  const parsed = recallCalendarWebhookSchema.parse(payload);

  if (parsed.event === "calendar.update") {
    return {
      eventType: parsed.event,
      calendarId: parsed.data.calendar_id,
      lastUpdatedTs: null,
    };
  }

  return {
    eventType: parsed.event,
    calendarId: parsed.data.calendar_id,
    lastUpdatedTs: parsed.data.last_updated_ts,
  };
}

export async function ensureRecallManagedCalendarConnectionForWorkspace(
  workspace: WorkspaceContext,
) {
  const existing = await findConnectionByWorkspace(workspace);

  if (existing?.recallCalendarId) {
    const calendar = normalizeRecallCalendar(
      await retrieveRecallCalendar(existing.recallCalendarId),
    );
    const status = calendar?.status ?? null;

    if (status) {
      await db
        .update(calendarConnections)
        .set({ recallCalendarStatus: status, updatedAt: new Date() })
        .where(eq(calendarConnections.id, existing.id));
    }

    return {
      ...existing,
      recallCalendarStatus: status,
    };
  }

  const calendar = await findRecallManagedCalendarForWorkspace(workspace);

  if (!calendar) {
    return null;
  }

  const existingRecallConnection = await findConnectionByRecallCalendarId(
    calendar.id,
  );

  if (existingRecallConnection) {
    await db
      .update(calendarConnections)
      .set({
        autoJoinEnabled: true,
        externalCalendarId: LEGACY_PRIMARY_CALENDAR_ID,
        teamId: workspace.teamId,
        userId: workspace.userId,
        recallCalendarStatus: calendar.status,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existingRecallConnection.id));
    await tagRecallCalendarForWorkspace(calendar, workspace);

    return {
      ...existingRecallConnection,
      autoJoinEnabled: true,
      teamId: workspace.teamId,
      userId: workspace.userId,
      workspaceDomain: workspace.domain,
      workspaceName: workspace.teamName,
      recallCalendarStatus: calendar.status,
    };
  }

  if (existing) {
    await db
      .update(calendarConnections)
      .set({
        autoJoinEnabled: true,
        externalCalendarId: LEGACY_PRIMARY_CALENDAR_ID,
        recallCalendarId: calendar.id,
        recallCalendarStatus: calendar.status,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, existing.id));
    await tagRecallCalendarForWorkspace(calendar, workspace);

    return {
      ...existing,
      autoJoinEnabled: true,
      recallCalendarId: calendar.id,
      recallCalendarStatus: calendar.status,
    };
  }

  const [connection] = await db
    .insert(calendarConnections)
    .values({
      teamId: workspace.teamId,
      userId: workspace.userId,
      provider: "google",
      externalCalendarId: LEGACY_PRIMARY_CALENDAR_ID,
      autoJoinEnabled: true,
      recallCalendarId: calendar.id,
      recallCalendarStatus: calendar.status,
    })
    .returning({
      id: calendarConnections.id,
      teamId: calendarConnections.teamId,
      userId: calendarConnections.userId,
      autoJoinEnabled: calendarConnections.autoJoinEnabled,
      recallCalendarId: calendarConnections.recallCalendarId,
      recallCalendarStatus: calendarConnections.recallCalendarStatus,
    });

  await tagRecallCalendarForWorkspace(calendar, workspace);

  return {
    ...connection,
    workspaceDomain: workspace.domain,
    workspaceName: workspace.teamName,
  };
}

export async function processRecallCalendarWebhook(
  event: RecallCalendarWebhook,
) {
  if (event.eventType === "calendar.update") {
    return processRecallCalendarUpdate(event.calendarId);
  }

  const connection = await findConnectionByRecallCalendarId(event.calendarId);

  if (!connection) {
    return { action: "skipped" as const, reason: "unknown_calendar" as const };
  }

  const events = await listRecallCalendarEvents({
    calendarId: event.calendarId,
    updatedAtGte: event.lastUpdatedTs ?? undefined,
  });
  let count = 0;

  for (const recallEvent of events) {
    const syncedEvent = normalizeRecallCalendarEvent(recallEvent);

    if (!syncedEvent) {
      continue;
    }

    await autoJoinCalendarEvent({
      connection,
      event: syncedEvent,
    });
    count += 1;
  }

  await advanceRecallCalendarSyncCursor(
    connection,
    event.lastUpdatedTs ? new Date(event.lastUpdatedTs) : new Date(),
  );

  return { action: "synced" as const, count };
}

export async function syncRecallCalendarEventsForWorkspace(input: {
  workspace: WorkspaceContext;
  autoJoinEnabled: boolean;
  forceBotConfigRefresh?: boolean;
  now?: Date;
}) {
  const existingConnection = await findConnectionByWorkspace(input.workspace);
  const connection = existingConnection?.recallCalendarId
    ? existingConnection
    : await ensureRecallManagedCalendarConnectionForWorkspace(input.workspace);

  if (!connection?.recallCalendarId) {
    throw new RecallCalendarConnectionError();
  }

  if (connection.autoJoinEnabled !== input.autoJoinEnabled) {
    await db
      .update(calendarConnections)
      .set({
        autoJoinEnabled: input.autoJoinEnabled,
        updatedAt: new Date(),
      })
      .where(eq(calendarConnections.id, connection.id));
  }

  const activeConnection = {
    id: connection.id,
    teamId: connection.teamId,
    userId: connection.userId,
    autoJoinEnabled: input.autoJoinEnabled,
    workspaceDomain: input.workspace.domain,
    workspaceName: input.workspace.teamName,
  };
  const now = input.now ?? new Date();
  const events = await listRecallCalendarEventsForSync({
    connection: {
      ...connection,
      recallCalendarId: connection.recallCalendarId,
    },
    forceFullSync: input.forceBotConfigRefresh === true,
    now,
  });
  let count = 0;
  let failedCount = 0;

  for (const recallEvent of events) {
    const syncedEvent = normalizeRecallCalendarEvent(recallEvent);

    if (!syncedEvent) {
      continue;
    }

    if (!shouldSyncRepairCalendarEvent(syncedEvent, now)) {
      continue;
    }

    try {
      await autoJoinCalendarEvent({
        connection: activeConnection,
        event: syncedEvent,
        forceBotConfigRefresh: input.forceBotConfigRefresh,
        repairMode: true,
      });
      count += 1;
    } catch (error) {
      if (!isRecoverableCalendarEventSyncError(error)) {
        throw error;
      }

      failedCount += 1;
    }
  }

  await advanceRecallCalendarSyncCursor(connection, now);

  return {
    connectionId: connection.id,
    failedEventCount: failedCount,
    syncedEventCount: count,
  };
}

function getRecallCalendarRepairStart(now: Date) {
  return new Date(now.getTime() - RECALL_CALENDAR_REPAIR_LOOKBACK_MS);
}

async function listRecallCalendarEventsForSync(input: {
  connection: RecallCalendarConnection & { recallCalendarId: string };
  forceFullSync: boolean;
  now: Date;
}) {
  const repairStart = getRecallCalendarRepairStart(input.now).toISOString();
  const lastSyncedAt = input.connection.recallCalendarLastSyncedAt;

  if (input.forceFullSync || !lastSyncedAt) {
    return listRecallCalendarEvents({
      calendarId: input.connection.recallCalendarId,
      startTimeGte: repairStart,
    });
  }

  const changeStart = new Date(
    Math.min(lastSyncedAt.getTime(), input.now.getTime()) -
      RECALL_CALENDAR_CHANGE_OVERLAP_MS,
  );
  const changedEvents = await listRecallCalendarEvents({
    calendarId: input.connection.recallCalendarId,
    updatedAtGte: changeStart.toISOString(),
  });
  const repairExternalEventIds = await listRecallCalendarRepairEventIds({
    connectionId: input.connection.id,
    now: input.now,
  });

  if (repairExternalEventIds.size === 0) {
    return changedEvents;
  }

  const repairCandidates = await listRecallCalendarEvents({
    calendarId: input.connection.recallCalendarId,
    startTimeGte: repairStart,
  });
  const eventsByExternalId = new Map<string, unknown>();

  for (const event of repairCandidates) {
    const normalized = normalizeRecallCalendarEvent(event);

    if (normalized && repairExternalEventIds.has(normalized.externalEventId)) {
      eventsByExternalId.set(normalized.externalEventId, event);
    }
  }

  for (const event of changedEvents) {
    const normalized = normalizeRecallCalendarEvent(event);

    if (normalized) {
      eventsByExternalId.set(normalized.externalEventId, event);
    }
  }

  return Array.from(eventsByExternalId.values());
}

async function listRecallCalendarRepairEventIds(input: {
  connectionId: string;
  now: Date;
}) {
  const rows = await databaseSql`
    select distinct event.external_event_id
    from calendar_events as event
    join meetings as meeting
      on meeting.team_id = event.team_id
      and (
        meeting.calendar_event_id = event.id
        or (
          event.team_meeting_key is not null
          and meeting.team_meeting_key = event.team_meeting_key
        )
      )
    where event.connection_id = ${input.connectionId}::uuid
      and event.starts_at >= ${getRecallCalendarRepairStart(input.now)}
      and (
        (
          meeting.status = 'scheduled'
          and meeting.recall_bot_id is not null
          and (
            meeting.meeting_url is distinct from event.meeting_url
            or meeting.started_at is distinct from event.starts_at
            or meeting.ended_at is distinct from event.ends_at
          )
        )
        or (
          (
            event.meeting_url ~* '^https?://meet[.]google[.]com/'
            or event.meeting_url ~* '^https?://([a-z0-9-]+[.])*zoom[.]us/(j|my)/'
          )
          and (
            (
              meeting.status = 'failed'
              and coalesce(
                event.ends_at,
                event.starts_at + interval '1 hour'
              ) > ${input.now}
            )
            or (
              meeting.status = 'scheduled'
              and meeting.recall_bot_id is null
            )
          )
        )
        or (
          meeting.recall_recording_id is not null
          and meeting.started_at <= ${input.now}
          and coalesce(
            event.ends_at,
            event.starts_at + interval '1 hour'
          ) > ${input.now}
          and meeting.started_at is distinct from event.starts_at
        )
      )
  `;

  return new Set(
    (rows ?? []).flatMap((row) =>
      typeof row.external_event_id === "string"
        ? [row.external_event_id]
        : [],
    ),
  );
}

async function advanceRecallCalendarSyncCursor(
  connection: RecallCalendarConnection,
  cursor: Date,
) {
  const currentCursor = connection.recallCalendarLastSyncedAt;

  if (currentCursor && currentCursor.getTime() >= cursor.getTime()) {
    return;
  }

  await db
    .update(calendarConnections)
    .set({
      recallCalendarLastSyncedAt: cursor,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(calendarConnections.id, connection.id),
        or(
          isNull(calendarConnections.recallCalendarLastSyncedAt),
          lt(calendarConnections.recallCalendarLastSyncedAt, cursor),
        ),
      ),
    );
}

function shouldSyncRepairCalendarEvent(event: SyncedCalendarEvent, now: Date) {
  const startTime = new Date(event.startsAt).getTime();

  if (!Number.isFinite(startTime)) {
    return false;
  }

  return startTime >= getRecallCalendarRepairStart(now).getTime();
}

function isRecoverableCalendarEventSyncError(error: unknown) {
  return error instanceof Error && error.message.startsWith("Recall ");
}

async function findRecallManagedCalendarForWorkspace(
  workspace: WorkspaceContext,
) {
  const calendars = (await listRecallCalendars())
    .map(normalizeRecallCalendar)
    .filter((calendar): calendar is RecallCalendarSummary => Boolean(calendar))
    .filter((calendar) => calendar.platform === "google_calendar")
    .filter((calendar) => calendar.status === "connected");

  const exactMatch = calendars.find(
    (calendar) =>
      calendar.metadata.teamId === workspace.teamId &&
      calendar.metadata.userId === workspace.userId,
  );

  if (exactMatch) {
    return exactMatch;
  }

  return null;
}

async function tagRecallCalendarForWorkspace(
  calendar: RecallCalendarSummary,
  workspace: WorkspaceContext,
) {
  if (
    calendar.metadata.teamId === workspace.teamId &&
    calendar.metadata.userId === workspace.userId
  ) {
    return;
  }

  await updateRecallCalendar({
    calendarId: calendar.id,
    metadata: {
      ...calendar.metadata,
      teamId: workspace.teamId,
      userId: workspace.userId,
    },
  }).catch(() => undefined);
}

async function processRecallCalendarUpdate(calendarId: string) {
  const connection = await findConnectionByRecallCalendarId(calendarId);

  if (!connection) {
    return { action: "skipped" as const, reason: "unknown_calendar" as const };
  }

  const calendar = (await retrieveRecallCalendar(calendarId)) as {
    status?: unknown;
  };
  const status = getString(calendar.status);

  await db
    .update(calendarConnections)
    .set({
      recallCalendarStatus: status,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.recallCalendarId, calendarId));

  return { action: "updated" as const, status };
}

async function findConnectionByRecallCalendarId(calendarId: string) {
  const [connection] = await db
    .select({
      id: calendarConnections.id,
      teamId: calendarConnections.teamId,
      userId: calendarConnections.userId,
      userEmail: users.email,
      teamName: sql<string>`(
        select ${teams.name}
        from ${teams}
        where ${teams.id} = ${calendarConnections.teamId}
      )`,
      autoJoinEnabled: calendarConnections.autoJoinEnabled,
      recallCalendarId: calendarConnections.recallCalendarId,
      recallCalendarLastSyncedAt:
        calendarConnections.recallCalendarLastSyncedAt,
      recallCalendarStatus: calendarConnections.recallCalendarStatus,
    })
    .from(calendarConnections)
    .innerJoin(users, eq(users.id, calendarConnections.userId))
    .where(eq(calendarConnections.recallCalendarId, calendarId))
    .limit(1);

  return connection
    ? {
        id: connection.id,
        teamId: connection.teamId,
        userId: connection.userId,
        autoJoinEnabled: connection.autoJoinEnabled,
        recallCalendarId: connection.recallCalendarId,
        recallCalendarLastSyncedAt: connection.recallCalendarLastSyncedAt,
        recallCalendarStatus: connection.recallCalendarStatus,
        workspaceDomain: normalizeEmailDomain(connection.userEmail),
        workspaceName: connection.teamName,
      }
    : null;
}

async function findConnectionByWorkspace(workspace: WorkspaceContext) {
  const connections = await db
    .select({
      id: calendarConnections.id,
      teamId: calendarConnections.teamId,
      userId: calendarConnections.userId,
      autoJoinEnabled: calendarConnections.autoJoinEnabled,
      recallCalendarId: calendarConnections.recallCalendarId,
      recallCalendarLastSyncedAt:
        calendarConnections.recallCalendarLastSyncedAt,
      recallCalendarStatus: calendarConnections.recallCalendarStatus,
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

  return connection
    ? {
        ...connection,
        workspaceDomain: workspace.domain,
        workspaceName: workspace.teamName,
      }
    : null;
}

function normalizeRecallCalendarEvent(event: unknown): SyncedCalendarEvent | null {
  if (!event || typeof event !== "object") {
    return null;
  }

  const candidate = event as Record<string, unknown>;
  const id = getString(candidate.id);
  const platformId = getString(candidate.platform_id);
  const startsAt = getString(candidate.start_time);

  if (!id || !startsAt) {
    return null;
  }

  const raw = getRecord(candidate.raw);
  const isDeleted = candidate.is_deleted === true;
  const iCalUid = getString(candidate.ical_uid);
  const originalStartTime = getOriginalStartTime(raw);

  return {
    externalEventId: platformId ?? id,
    recallCalendarEventId: id,
    recallCalendarEventDeduplicationKey: getDeduplicationKey({
      iCalUid,
      originalStartTime,
      platformId,
      recallEventId: id,
    }),
    title: getString(raw?.summary) ?? "Untitled calendar event",
    startsAt,
    endsAt: getString(candidate.end_time),
    attendees: getAttendees(raw?.attendees),
    attendeeEmails: getAttendeeEmails(raw?.attendees),
    meetingUrl: isDeleted ? null : getString(candidate.meeting_url),
    location: getString(raw?.location),
    description: getString(raw?.description),
    hangoutLink: getString(raw?.hangoutLink),
    isDeleted,
    recallCalendarEventBots: normalizeRecallCalendarEventBots(candidate.bots),
    conferenceData: normalizeConferenceData(raw?.conferenceData),
  };
}

function normalizeRecallCalendarEventBots(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map((bot) => {
      const candidate = getRecord(bot);
      const botId = getString(candidate?.bot_id);

      if (!botId) {
        return null;
      }

      return {
        botId,
        deduplicationKey: getString(candidate?.deduplication_key),
      };
    })
    .filter(
      (
        bot,
      ): bot is {
        botId: string;
        deduplicationKey: string | null;
      } => Boolean(bot),
    );
}

function normalizeRecallCalendar(calendar: unknown): RecallCalendarSummary | null {
  const candidate = getRecord(calendar);
  const id = getString(candidate?.id);

  if (!id) {
    return null;
  }

  return {
    id,
    platform: getString(candidate?.platform),
    platformEmail:
      getString(candidate?.platform_email) ?? getString(candidate?.oauth_email),
    status: getString(candidate?.status),
    metadata: getStringRecord(candidate?.metadata),
  };
}

function getDeduplicationKey(input: {
  iCalUid: string | null;
  originalStartTime: string | null;
  platformId: string | null;
  recallEventId: string;
}) {
  if (input.iCalUid && input.originalStartTime) {
    return `${input.iCalUid}:${input.originalStartTime}`;
  }

  return input.iCalUid ?? input.platformId ?? input.recallEventId;
}

function getOriginalStartTime(raw: Record<string, unknown> | null) {
  const originalStartTime = getRecord(raw?.originalStartTime);

  return (
    getString(originalStartTime?.dateTime) ??
    getString(originalStartTime?.date) ??
    null
  );
}

function normalizeConferenceData(value: unknown) {
  const conferenceData = getRecord(value);
  const entryPoints = Array.isArray(conferenceData?.entryPoints)
    ? conferenceData.entryPoints
    : [];

  if (!conferenceData && entryPoints.length === 0) {
    return null;
  }

  return {
    entryPoints: entryPoints.map((entryPoint) => {
      const candidate = getRecord(entryPoint);

      return {
        entryPointType: getString(candidate?.entryPointType),
        uri: getString(candidate?.uri),
      };
    }),
  };
}

function getAttendeeEmails(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attendee) => getString(getRecord(attendee)?.email))
    .filter((email): email is string => Boolean(email));
}

function getAttendees(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attendee) => {
      const record = getRecord(attendee);
      const email = getString(record?.email);

      if (!email) {
        return null;
      }

      return {
        email,
        responseStatus: getString(record?.responseStatus),
      };
    })
    .filter(
      (
        attendee,
      ): attendee is {
        email: string;
        responseStatus: string | null;
      } => Boolean(attendee),
    );
}

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getStringRecord(value: unknown) {
  const record = getRecord(value);

  if (!record) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
