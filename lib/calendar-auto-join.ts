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
  deleteScheduledRecallBot,
  scheduleRecallBot,
  updateScheduledRecallBot,
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

type ExistingMeeting = {
  id: string;
  recallBotId: string | null;
  meetingUrl: string | null;
  startedAt: Date | null;
  status: string;
};

export function findCalendarMeetingUrl(event: SyncedCalendarEvent) {
  const candidates = [
    event.meetingUrl,
    ...getConferenceEntryPointUris(event),
    event.hangoutLink,
    ...extractUrls(event.location),
    ...extractUrls(event.description),
  ];

  return candidates.find(isSupportedMeetingUrl) ?? candidates.find(isHttpUrl) ?? null;
}

export async function autoJoinCalendarEvent(input: AutoJoinInput) {
  const meetingUrl = findCalendarMeetingUrl(input.event);
  const platform = meetingUrl ? detectMeetingPlatform(meetingUrl) : null;
  const title = normalizeEventTitle(input.event, platform);
  const startsAt = parseEventDate(input.event.startsAt);
  const endsAt = input.event.endsAt ? parseEventDate(input.event.endsAt) : null;
  const [calendarEvent] = await db
    .insert(calendarEvents)
    .values({
      teamId: input.connection.teamId,
      connectionId: input.connection.id,
      externalEventId: input.event.externalEventId,
      title,
      meetingUrl,
      startsAt,
      endsAt,
      attendeeEmails: normalizeAttendeeEmails(input.event.attendeeEmails ?? []),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [calendarEvents.connectionId, calendarEvents.externalEventId],
      set: {
        title,
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

  const existing = await db
    .select({
      id: meetings.id,
      recallBotId: meetings.recallBotId,
      meetingUrl: meetings.meetingUrl,
      startedAt: meetings.startedAt,
      status: meetings.status,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, input.connection.teamId),
        eq(meetings.calendarEventId, calendarEvent.id),
      ),
    )
    .limit(1);

  const existingMeeting = existing[0];

  if (!meetingUrl) {
    if (existingMeeting?.recallBotId && existingMeeting.status === "scheduled") {
      await cancelScheduledMeetingBotFromCalendar({
        botId: existingMeeting.recallBotId,
        endsAt,
        meetingId: existingMeeting.id,
        meetingUrl: null,
        startsAt,
        title,
      });

      return {
        action: "skipped" as const,
        calendarEventId: calendarEvent.id,
        meetingId: existingMeeting.id,
        reason: "missing_meeting_link" as const,
      };
    }

    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      reason: "missing_meeting_link" as const,
    };
  }

  if (!platform) {
    if (existingMeeting?.recallBotId && existingMeeting.status === "scheduled") {
      await cancelScheduledMeetingBotFromCalendar({
        botId: existingMeeting.recallBotId,
        endsAt,
        meetingId: existingMeeting.id,
        meetingUrl,
        startsAt,
        title,
      });

      return {
        action: "skipped" as const,
        calendarEventId: calendarEvent.id,
        meetingId: existingMeeting.id,
        meetingUrl,
        reason: "unsupported_meeting_link" as const,
      };
    }

    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingUrl,
      reason: "unsupported_meeting_link" as const,
    };
  }

  if (existingMeeting?.recallBotId) {
    if (existingMeeting.status !== "scheduled") {
      return {
        action: "skipped" as const,
        calendarEventId: calendarEvent.id,
        meetingId: existingMeeting.id,
        meetingUrl,
        reason: "already_scheduled" as const,
      };
    }

    const shouldUpdateBot = hasScheduledBotChange(existingMeeting, {
      meetingUrl,
      startsAt,
    });

    try {
      if (shouldUpdateBot) {
        await updateScheduledRecallBot({
          botId: existingMeeting.recallBotId,
          meetingUrl,
          startAt: startsAt.toISOString(),
          metadata: {
            calendarEventId: calendarEvent.id,
            meetingId: existingMeeting.id,
          },
        });
      }

      await updateMeetingFromCalendar({
        meetingId: existingMeeting.id,
        title,
        platform,
        meetingUrl,
        startsAt,
        endsAt,
      });
    } catch (error) {
      await markMeetingFailed(existingMeeting.id);
      throw error;
    }

    if (shouldUpdateBot) {
      return {
        action: "updated" as const,
        calendarEventId: calendarEvent.id,
        meetingId: existingMeeting.id,
        meetingUrl,
        platform,
        recallBotId: existingMeeting.recallBotId,
      };
    }

    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      meetingId: existingMeeting.id,
      meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  const meeting =
    existingMeeting ??
    (
      await db
        .insert(meetings)
        .values({
          teamId: input.connection.teamId,
          ownerUserId: input.connection.userId,
          calendarEventId: calendarEvent.id,
          title,
          platform,
          status: "scheduled",
          meetingUrl,
          startedAt: startsAt,
          endedAt: endsAt,
        })
        .returning({ id: meetings.id })
    )[0];

  const attendeeEmails = normalizeAttendeeEmails(input.event.attendeeEmails ?? []);

  if (!existingMeeting && attendeeEmails.length > 0) {
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
        title,
        platform,
        meetingUrl,
        startedAt: startsAt,
        endedAt: endsAt,
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
    await markMeetingFailed(meeting.id);

    throw error;
  }
}

async function updateMeetingFromCalendar(input: {
  meetingId: string;
  title: string;
  platform: SupportedMeetingPlatform;
  meetingUrl: string;
  startsAt: Date;
  endsAt: Date | null;
}) {
  await db
    .update(meetings)
    .set({
      title: input.title,
      platform: input.platform,
      meetingUrl: input.meetingUrl,
      startedAt: input.startsAt,
      endedAt: input.endsAt,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
}

async function markMeetingFailed(meetingId: string) {
  await db
    .update(meetings)
    .set({
      status: "failed",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meetingId));
}

async function cancelScheduledMeetingBotFromCalendar(input: {
  botId: string;
  meetingId: string;
  title: string;
  meetingUrl: string | null;
  startsAt: Date;
  endsAt: Date | null;
}) {
  await deleteScheduledRecallBot({ botId: input.botId });
  await db
    .update(meetings)
    .set({
      title: input.title,
      meetingUrl: input.meetingUrl,
      startedAt: input.startsAt,
      endedAt: input.endsAt,
      recallBotId: null,
      status: "failed",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
}

function hasScheduledBotChange(
  meeting: ExistingMeeting,
  next: { meetingUrl: string; startsAt: Date },
) {
  return (
    meeting.meetingUrl !== next.meetingUrl ||
    meeting.startedAt?.getTime() !== next.startsAt.getTime()
  );
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

function isHttpUrl(value?: string | null): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
