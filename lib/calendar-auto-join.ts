import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarEvents, meetingAttendees, meetings } from "@/db/schema";
import { normalizeEmail } from "@/lib/access";
import {
  buildAppUrl,
  detectMeetingPlatform,
  type SupportedMeetingPlatform,
} from "@/lib/meeting-links";
import {
  DEFAULT_RECALL_BOT_NAME,
  scheduleRecallBot,
} from "@/lib/vendors/recall";

type CalendarConnection = {
  id: string;
  teamId: string;
  userId: string;
  autoJoinEnabled: boolean;
};

type CalendarEventEntryPoint = {
  entryPointType?: string | null;
  uri?: string | null;
};

export type SyncedCalendarEvent = {
  externalEventId: string;
  title: string;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  attendeeEmails?: string[];
  meetingUrl?: string | null;
  location?: string | null;
  description?: string | null;
  hangoutLink?: string | null;
  conferenceData?: {
    entryPoints?: CalendarEventEntryPoint[] | null;
  } | null;
};

type AutoJoinInput = {
  connection: CalendarConnection;
  event: SyncedCalendarEvent;
};

type RecallBotResponse = {
  id?: unknown;
};

export function findCalendarMeetingUrl(event: SyncedCalendarEvent) {
  const candidates = [
    event.meetingUrl,
    ...getConferenceEntryPointUris(event),
    event.hangoutLink,
    ...extractUrls(event.location),
    ...extractUrls(event.description),
  ];

  return candidates.find(isSupportedMeetingUrl) ?? null;
}

export async function autoJoinCalendarEvent(input: AutoJoinInput) {
  const meetingUrl = findCalendarMeetingUrl(input.event);
  const platform = meetingUrl ? detectMeetingPlatform(meetingUrl) : null;
  const startsAt = parseEventDate(input.event.startsAt);
  const endsAt = input.event.endsAt ? parseEventDate(input.event.endsAt) : null;
  const [calendarEvent] = await db
    .insert(calendarEvents)
    .values({
      teamId: input.connection.teamId,
      connectionId: input.connection.id,
      externalEventId: input.event.externalEventId,
      title: normalizeEventTitle(input.event, platform),
      meetingUrl,
      startsAt,
      endsAt,
      attendeeEmails: normalizeAttendeeEmails(input.event.attendeeEmails ?? []),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [calendarEvents.connectionId, calendarEvents.externalEventId],
      set: {
        title: normalizeEventTitle(input.event, platform),
        meetingUrl,
        startsAt,
        endsAt,
        attendeeEmails: normalizeAttendeeEmails(input.event.attendeeEmails ?? []),
        updatedAt: new Date(),
      },
    })
    .returning({ id: calendarEvents.id });

  if (!input.connection.autoJoinEnabled) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      reason: "auto_join_disabled" as const,
    };
  }

  if (!meetingUrl) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      reason: "missing_meeting_link" as const,
    };
  }

  if (!platform) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingUrl,
      reason: "unsupported_meeting_link" as const,
    };
  }

  const existing = await db
    .select({ id: meetings.id, recallBotId: meetings.recallBotId })
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, input.connection.teamId),
        eq(meetings.calendarEventId, calendarEvent.id),
      ),
    )
    .limit(1);

  if (existing[0]?.recallBotId) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingId: existing[0].id,
      meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  const meeting =
    existing[0] ??
    (
      await db
        .insert(meetings)
        .values({
          teamId: input.connection.teamId,
          ownerUserId: input.connection.userId,
          calendarEventId: calendarEvent.id,
          title: normalizeEventTitle(input.event, platform),
          platform,
          status: "scheduled",
          meetingUrl,
          startedAt: startsAt,
          endedAt: endsAt,
        })
        .returning({ id: meetings.id })
    )[0];

  const attendeeEmails = normalizeAttendeeEmails(input.event.attendeeEmails ?? []);

  if (!existing[0] && attendeeEmails.length > 0) {
    await db
      .insert(meetingAttendees)
      .values(
        attendeeEmails.map((email) => ({
          meetingId: meeting.id,
          email,
        })),
      )
      .onConflictDoNothing({
        target: [meetingAttendees.meetingId, meetingAttendees.email],
      });
  }

  try {
    const bot = (await scheduleRecallBot({
      meetingUrl,
      botName: DEFAULT_RECALL_BOT_NAME,
      startAt: startsAt.toISOString(),
      webhookUrl: buildAppUrl("/api/recall/webhook"),
      metadata: {
        calendarEventId: calendarEvent.id,
        meetingId: meeting.id,
      },
    })) as RecallBotResponse;

    if (typeof bot.id !== "string") {
      throw new Error("Recall bot response missing id");
    }

    await db
      .update(meetings)
      .set({
        recallBotId: bot.id,
        status: "scheduled",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));

    return {
      action: "scheduled" as const,
      calendarEventId: calendarEvent.id,
      meetingId: meeting.id,
      meetingUrl,
      platform,
      recallBotId: bot.id,
    };
  } catch (error) {
    await db
      .update(meetings)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(meetings.id, meeting.id));

    throw error;
  }
}

function getConferenceEntryPointUris(event: SyncedCalendarEvent) {
  return (event.conferenceData?.entryPoints ?? [])
    .filter(
      (entryPoint) =>
        !entryPoint.entryPointType || entryPoint.entryPointType === "video",
    )
    .map((entryPoint) => entryPoint.uri);
}

function extractUrls(value?: string | null) {
  return Array.from(value?.matchAll(/https?:\/\/[^\s<>"']+/g) ?? [], (match) =>
    trimUrlPunctuation(match[0]),
  );
}

function trimUrlPunctuation(value: string) {
  return value.replace(/[),.;\]]+$/, "");
}

function isSupportedMeetingUrl(value?: string | null): value is string {
  return Boolean(value && detectMeetingPlatform(value));
}

function normalizeAttendeeEmails(attendeeEmails: string[]) {
  return Array.from(
    new Set(
      attendeeEmails
        .map(normalizeEmail)
        .filter((email) => email.includes("@")),
    ),
  );
}

function normalizeEventTitle(
  event: SyncedCalendarEvent,
  platform: SupportedMeetingPlatform | null,
) {
  const title = event.title.trim();

  if (title) {
    return title;
  }

  return platform === "zoom" ? "Zoom recording" : "Google Meet recording";
}

function parseEventDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Calendar event date is invalid");
  }

  return date;
}
