import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { calendarConnections } from "@/db/schema";
import { autoJoinCalendarEvent, type SyncedCalendarEvent } from "@/lib/calendar-auto-join";
import {
  listRecallCalendarEvents,
  retrieveRecallCalendar,
} from "@/lib/vendors/recall";

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
      last_updated_ts: z.string().datetime(),
    }),
  }),
]);

type RecallCalendarWebhook = ReturnType<typeof normalizeRecallCalendarWebhook>;

type RecallCalendarConnection = {
  id: string;
  teamId: string;
  userId: string;
  autoJoinEnabled: boolean;
};

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
      autoJoinEnabled: calendarConnections.autoJoinEnabled,
    })
    .from(calendarConnections)
    .where(eq(calendarConnections.recallCalendarId, calendarId))
    .limit(1);

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
