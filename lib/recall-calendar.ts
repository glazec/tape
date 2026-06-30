import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { calendarConnections, users } from "@/db/schema";
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
  recallCalendarStatus?: string | null;
  workspaceDomain?: string | null;
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

  return connection;
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

  await db
    .update(calendarConnections)
    .set({
      recallCalendarLastSyncedAt: event.lastUpdatedTs
        ? new Date(event.lastUpdatedTs)
        : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.recallCalendarId, event.calendarId));

  return { action: "synced" as const, count };
}

export async function syncRecallCalendarEventsForWorkspace(input: {
  workspace: WorkspaceContext;
  autoJoinEnabled: boolean;
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
  };
  const now = input.now ?? new Date();
  const events = await listRecallCalendarEvents({
    calendarId: connection.recallCalendarId,
    startTimeGte: getRecallCalendarRepairStart(now).toISOString(),
  });
  let count = 0;

  for (const recallEvent of events) {
    const syncedEvent = normalizeRecallCalendarEvent(recallEvent);

    if (!syncedEvent) {
      continue;
    }

    if (!shouldSyncRepairCalendarEvent(syncedEvent, now)) {
      continue;
    }

    await autoJoinCalendarEvent({
      connection: activeConnection,
      event: syncedEvent,
    });
    count += 1;
  }

  await db
    .update(calendarConnections)
    .set({
      recallCalendarLastSyncedAt: now,
      updatedAt: new Date(),
    })
    .where(eq(calendarConnections.id, connection.id));

  return {
    connectionId: connection.id,
    syncedEventCount: count,
  };
}

function getRecallCalendarRepairStart(now: Date) {
  return new Date(now.getTime() - RECALL_CALENDAR_REPAIR_LOOKBACK_MS);
}

function shouldSyncRepairCalendarEvent(event: SyncedCalendarEvent, now: Date) {
  const startTime = new Date(event.startsAt).getTime();

  if (!Number.isFinite(startTime)) {
    return false;
  }

  if (startTime >= now.getTime()) {
    return true;
  }

  if (!event.endsAt) {
    return false;
  }

  const endTime = new Date(event.endsAt).getTime();

  return Number.isFinite(endTime) && endTime >= now.getTime();
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

  const teamMatch = calendars.find(
    (calendar) => calendar.metadata.teamId === workspace.teamId,
  );

  if (teamMatch) {
    return teamMatch;
  }

  return calendars.length === 1 ? calendars[0] : null;
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
      autoJoinEnabled: calendarConnections.autoJoinEnabled,
      recallCalendarId: calendarConnections.recallCalendarId,
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
        recallCalendarStatus: connection.recallCalendarStatus,
        workspaceDomain: normalizeEmailDomain(connection.userEmail),
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

  return (connection ?? null) as RecallCalendarConnection | null;
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
    attendeeEmails: getAttendeeEmails(raw?.attendees),
    meetingUrl: isDeleted ? null : getString(candidate.meeting_url),
    location: getString(raw?.location),
    description: getString(raw?.description),
    hangoutLink: getString(raw?.hangoutLink),
    isDeleted,
    conferenceData: normalizeConferenceData(raw?.conferenceData),
  };
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
