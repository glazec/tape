import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";

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
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  scheduleRecallCalendarEventBot,
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
  isDeleted?: boolean;
  recallCalendarEventId?: string | null;
  recallCalendarEventDeduplicationKey?: string | null;
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
  bots?: Array<{
    bot_id?: unknown;
    deduplication_key?: unknown;
  }>;
};

type ExistingMeeting = {
  id: string;
  calendarEventId?: string | null;
  teamMeetingKey?: string | null;
  recallBotId: string | null;
  meetingUrl: string | null;
  startedAt: Date | null;
  status: string;
};

type CalendarEventRow = {
  id: string;
  teamMeetingKey?: string | null;
};

export function findCalendarMeetingUrl(event: SyncedCalendarEvent) {
  const structuredCandidates = [
    event.meetingUrl,
    ...getConferenceEntryPointUris(event),
    event.hangoutLink,
  ];
  const textCandidates = [
    ...extractUrls(event.location),
    ...extractUrls(event.description),
  ];

  return (
    [...structuredCandidates, ...textCandidates].find(isSupportedMeetingUrl) ??
    structuredCandidates.find(isHttpUrl) ??
    null
  );
}

export async function autoJoinCalendarEvent(input: AutoJoinInput) {
  const meetingUrl = input.event.isDeleted
    ? null
    : findCalendarMeetingUrl(input.event);
  const platform = meetingUrl ? detectMeetingPlatform(meetingUrl) : null;
  const title = normalizeEventTitle(input.event, platform);
  const startsAt = parseEventDate(input.event.startsAt);
  const endsAt = input.event.endsAt ? parseEventDate(input.event.endsAt) : null;
  const teamMeetingKey =
    meetingUrl && platform
      ? buildTeamMeetingKey({
          teamId: input.connection.teamId,
          startsAt,
          meetingUrl,
        })
      : null;
  const [calendarEvent] = await db
    .insert(calendarEvents)
    .values({
      teamId: input.connection.teamId,
      connectionId: input.connection.id,
      externalEventId: input.event.externalEventId,
      title,
      teamMeetingKey,
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
        teamMeetingKey:
          teamMeetingKey ??
          sql`coalesce(${calendarEvents.teamMeetingKey}, excluded.team_meeting_key)`,
        meetingUrl,
        startsAt,
        endsAt,
        attendeeEmails: normalizeAttendeeEmails(input.event.attendeeEmails ?? []),
        updatedAt: new Date(),
      },
    })
    .returning({
      id: calendarEvents.id,
      teamMeetingKey: calendarEvents.teamMeetingKey,
    });
  const activeTeamMeetingKey =
    teamMeetingKey ?? calendarEvent.teamMeetingKey ?? null;

  if (!input.connection.autoJoinEnabled) {
    return {
      action: "skipped" as const,
      calendarEventId: calendarEvent.id,
      reason: "auto_join_disabled" as const,
    };
  }

  let existingMeeting = await findExistingMeeting({
    teamId: input.connection.teamId,
    calendarEventId: calendarEvent.id,
    teamMeetingKey: activeTeamMeetingKey,
  });

  if (!meetingUrl) {
    if (existingMeeting?.recallBotId && existingMeeting.status === "scheduled") {
      if (
        await hasOtherActiveCalendarEventForTeamMeeting({
          teamId: input.connection.teamId,
          calendarEvent,
          teamMeetingKey: activeTeamMeetingKey,
        })
      ) {
        return {
          action: "skipped" as const,
          calendarEventId: calendarEvent.id,
          meetingId: existingMeeting.id,
          reason: "shared_meeting_still_scheduled" as const,
        };
      }

      await cancelScheduledMeetingBotFromCalendar({
        botId: existingMeeting.recallBotId,
        endsAt,
        meetingId: existingMeeting.id,
        meetingUrl: null,
        recallCalendarEventId: input.event.recallCalendarEventId,
        skipVendorDelete: input.event.isDeleted === true,
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
      if (
        await hasOtherActiveCalendarEventForTeamMeeting({
          teamId: input.connection.teamId,
          calendarEvent,
          teamMeetingKey: activeTeamMeetingKey,
        })
      ) {
        return {
          action: "skipped" as const,
          calendarEventId: calendarEvent.id,
          meetingId: existingMeeting.id,
          meetingUrl,
          reason: "shared_meeting_still_scheduled" as const,
        };
      }

      await cancelScheduledMeetingBotFromCalendar({
        botId: existingMeeting.recallBotId,
        endsAt,
        meetingId: existingMeeting.id,
        meetingUrl,
        recallCalendarEventId: input.event.recallCalendarEventId,
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
    return syncExistingCalendarMeeting({
      meeting: existingMeeting,
      event: input.event,
      calendarEvent,
      title,
      platform,
      meetingUrl,
      startsAt,
      endsAt,
      teamMeetingKey: activeTeamMeetingKey,
    });
  }

  let meeting: ExistingMeeting | { id: string } | null = existingMeeting;
  let createdMeeting = false;

  if (!meeting) {
    try {
      meeting = (
        await db
          .insert(meetings)
          .values({
            teamId: input.connection.teamId,
            ownerUserId: input.connection.userId,
            calendarEventId: calendarEvent.id,
            teamMeetingKey: activeTeamMeetingKey,
            title,
            platform,
            status: "scheduled",
            meetingUrl,
            startedAt: startsAt,
            endedAt: endsAt,
          })
          .returning({ id: meetings.id })
      )[0];
      createdMeeting = true;
    } catch (error) {
      if (!isTeamMeetingKeyUniqueConflict(error) || !activeTeamMeetingKey) {
        throw error;
      }

      existingMeeting = await findExistingMeeting({
        teamId: input.connection.teamId,
        calendarEventId: calendarEvent.id,
        teamMeetingKey: activeTeamMeetingKey,
      });

      if (!existingMeeting) {
        throw error;
      }

      meeting = existingMeeting;
    }
  }

  if (meeting && "recallBotId" in meeting && meeting.recallBotId) {
    return syncExistingCalendarMeeting({
      meeting,
      event: input.event,
      calendarEvent,
      title,
      platform,
      meetingUrl,
      startsAt,
      endsAt,
      teamMeetingKey: activeTeamMeetingKey,
      forceScheduleBot: true,
    });
  }

  if (!meeting) {
    throw new Error("Meeting creation failed");
  }

  const attendeeEmails = normalizeAttendeeEmails(input.event.attendeeEmails ?? []);

  if (createdMeeting && attendeeEmails.length > 0) {
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
    const bot = await scheduleBotForCalendarEvent({
      event: input.event,
      meetingUrl,
      startsAt,
      teamMeetingKey: activeTeamMeetingKey,
      calendarEventId: calendarEvent.id,
      meetingId: meeting.id,
    });
    const recallBotId = getRecallBotResponseId(
      bot,
      getRecallCalendarEventBotDeduplicationKey({
        event: input.event,
        teamMeetingKey: activeTeamMeetingKey,
      }),
    );

    if (!recallBotId) {
      throw new Error("Recall bot response missing id");
    }

    await db
      .update(meetings)
      .set({
        recallBotId,
        teamMeetingKey: activeTeamMeetingKey,
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
      recallBotId,
    };
  } catch (error) {
    await markMeetingFailed(meeting.id);

    throw error;
  }
}

async function syncExistingCalendarMeeting(input: {
  meeting: ExistingMeeting;
  event: SyncedCalendarEvent;
  calendarEvent: CalendarEventRow;
  title: string;
  platform: SupportedMeetingPlatform;
  meetingUrl: string;
  startsAt: Date;
  endsAt: Date | null;
  teamMeetingKey?: string | null;
  forceScheduleBot?: boolean;
}) {
  if (input.meeting.status !== "scheduled") {
    return {
      action: "skipped" as const,
      calendarEventId: input.calendarEvent.id,
      meetingId: input.meeting.id,
      meetingUrl: input.meetingUrl,
      reason: "already_scheduled" as const,
    };
  }

  const shouldUpdateBot = hasScheduledBotChange(input.meeting, {
    meetingUrl: input.meetingUrl,
    startsAt: input.startsAt,
  });
  const shouldLinkRecallCalendarEvent = Boolean(
    input.event.recallCalendarEventId &&
      input.meeting.calendarEventId !== input.calendarEvent.id,
  );
  const shouldScheduleBot =
    input.forceScheduleBot || shouldUpdateBot || shouldLinkRecallCalendarEvent;
  let recallBotId = input.meeting.recallBotId;

  try {
    if (shouldScheduleBot) {
      const bot = await scheduleBotForCalendarEvent({
        event: input.event,
        meetingUrl: input.meetingUrl,
        startsAt: input.startsAt,
        teamMeetingKey: input.teamMeetingKey,
        calendarEventId: input.calendarEvent.id,
        meetingId: input.meeting.id,
        existingBotId: input.meeting.recallBotId ?? undefined,
      });
      recallBotId = getRecallBotResponseId(
        bot,
        getRecallCalendarEventBotDeduplicationKey({
          event: input.event,
          teamMeetingKey: input.teamMeetingKey,
        }),
      ) ?? input.meeting.recallBotId;
    }

    await updateMeetingFromCalendar({
      meetingId: input.meeting.id,
      title: input.title,
      platform: input.platform,
      meetingUrl: input.meetingUrl,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      teamMeetingKey: input.teamMeetingKey,
      recallBotId,
    });
  } catch (error) {
    await markMeetingFailed(input.meeting.id);
    throw error;
  }

  if (shouldUpdateBot && !input.forceScheduleBot) {
    return {
      action: "updated" as const,
      calendarEventId: input.calendarEvent.id,
      meetingId: input.meeting.id,
      meetingUrl: input.meetingUrl,
      platform: input.platform,
      recallBotId,
    };
  }

  if (shouldLinkRecallCalendarEvent || input.forceScheduleBot) {
    return {
      action: "scheduled" as const,
      calendarEventId: input.calendarEvent.id,
      meetingId: input.meeting.id,
      meetingUrl: input.meetingUrl,
      platform: input.platform,
      recallBotId,
    };
  }

  return {
    action: "skipped" as const,
    calendarEventId: input.calendarEvent.id,
    meetingId: input.meeting.id,
    meetingUrl: input.meetingUrl,
    reason: "already_scheduled" as const,
  };
}

async function updateMeetingFromCalendar(input: {
  meetingId: string;
  title: string;
  platform: SupportedMeetingPlatform;
  meetingUrl: string;
  startsAt: Date;
  endsAt: Date | null;
  teamMeetingKey?: string | null;
  recallBotId?: string | null;
}) {
  await db
    .update(meetings)
    .set({
      title: input.title,
      platform: input.platform,
      teamMeetingKey: input.teamMeetingKey,
      meetingUrl: input.meetingUrl,
      startedAt: input.startsAt,
      endedAt: input.endsAt,
      recallBotId: input.recallBotId,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
}

async function findExistingMeeting(input: {
  teamId: string;
  calendarEventId: string;
  teamMeetingKey?: string | null;
}) {
  const existing = await db
    .select({
      id: meetings.id,
      calendarEventId: meetings.calendarEventId,
      teamMeetingKey: meetings.teamMeetingKey,
      recallBotId: meetings.recallBotId,
      meetingUrl: meetings.meetingUrl,
      startedAt: meetings.startedAt,
      status: meetings.status,
    })
    .from(meetings)
    .where(
      input.teamMeetingKey
        ? and(
            eq(meetings.teamId, input.teamId),
            or(
              eq(meetings.calendarEventId, input.calendarEventId),
              eq(meetings.teamMeetingKey, input.teamMeetingKey),
            ),
          )
        : and(
            eq(meetings.teamId, input.teamId),
            eq(meetings.calendarEventId, input.calendarEventId),
          ),
    )
    .limit(1);

  return existing[0] ?? null;
}

async function hasOtherActiveCalendarEventForTeamMeeting(input: {
  teamId: string;
  calendarEvent: CalendarEventRow;
  teamMeetingKey?: string | null;
}) {
  if (!input.teamMeetingKey) {
    return false;
  }

  const active = await db
    .select({
      id: calendarEvents.id,
      meetingUrl: calendarEvents.meetingUrl,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, input.teamId),
        eq(calendarEvents.teamMeetingKey, input.teamMeetingKey),
        ne(calendarEvents.id, input.calendarEvent.id),
        isNotNull(calendarEvents.meetingUrl),
      ),
    )
    .limit(25);

  return active.some((event) => isSupportedMeetingUrl(event.meetingUrl));
}

function isTeamMeetingKeyUniqueConflict(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return (
    candidate.code === "23505" &&
    candidate.constraint === "meetings_team_meeting_key_unique"
  );
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
  recallCalendarEventId?: string | null;
  skipVendorDelete?: boolean;
  startsAt: Date;
  endsAt: Date | null;
}) {
  if (input.skipVendorDelete) {
    // Recall Calendar V2 automatically removes scheduled bots for deleted events.
  } else if (input.recallCalendarEventId) {
    await deleteRecallCalendarEventBot({
      calendarEventId: input.recallCalendarEventId,
    });
  } else {
    await deleteScheduledRecallBot({ botId: input.botId });
  }
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

async function scheduleBotForCalendarEvent(input: {
  event: SyncedCalendarEvent;
  meetingUrl: string;
  startsAt: Date;
  teamMeetingKey?: string | null;
  calendarEventId: string;
  meetingId: string;
  existingBotId?: string;
}) {
  const metadata = {
    calendarEventId: input.calendarEventId,
    meetingId: input.meetingId,
  };

  if (input.event.recallCalendarEventId) {
    return (await scheduleRecallCalendarEventBot({
      calendarEventId: input.event.recallCalendarEventId,
      deduplicationKey:
        input.teamMeetingKey ??
        input.event.recallCalendarEventDeduplicationKey ??
        input.event.recallCalendarEventId,
      botName: DEFAULT_RECALL_BOT_NAME,
      metadata,
    })) as RecallBotResponse;
  }

  if (input.existingBotId) {
    return (await updateScheduledRecallBot({
      botId: input.existingBotId,
      meetingUrl: input.meetingUrl,
      startAt: input.startsAt.toISOString(),
      metadata,
    })) as RecallBotResponse;
  }

  return (await scheduleRecallBot({
    meetingUrl: input.meetingUrl,
    botName: DEFAULT_RECALL_BOT_NAME,
    startAt: input.startsAt.toISOString(),
    webhookUrl: buildAppUrl("/api/recall/webhook"),
    metadata,
  })) as RecallBotResponse;
}

function buildTeamMeetingKey(input: {
  teamId: string;
  startsAt: Date;
  meetingUrl: string;
}) {
  return [
    `team:${input.teamId}`,
    `start:${input.startsAt.toISOString()}`,
    `url:${normalizeMeetingUrlForKey(input.meetingUrl)}`,
  ].join(":");
}

function normalizeMeetingUrlForKey(meetingUrl: string) {
  try {
    const url = new URL(meetingUrl);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");

    return url.toString().replace(/\/$/, "");
  } catch {
    return meetingUrl.trim();
  }
}

function getRecallCalendarEventBotDeduplicationKey(input: {
  event: SyncedCalendarEvent;
  teamMeetingKey?: string | null;
}) {
  if (!input.event.recallCalendarEventId) {
    return null;
  }

  return (
    input.teamMeetingKey ??
    input.event.recallCalendarEventDeduplicationKey ??
    input.event.recallCalendarEventId
  );
}

function getRecallBotResponseId(
  bot: RecallBotResponse,
  deduplicationKey?: string | null,
) {
  if (deduplicationKey) {
    const botEntry = bot.bots?.find(
      (candidate) =>
        candidate.deduplication_key === deduplicationKey &&
        typeof candidate.bot_id === "string",
    );

    return typeof botEntry?.bot_id === "string" ? botEntry.bot_id : null;
  }

  const botEntry = bot.bots?.find(
    (candidate) => typeof candidate.bot_id === "string",
  );

  if (typeof botEntry?.bot_id === "string") {
    return botEntry.bot_id;
  }

  return typeof bot.id === "string" ? bot.id : null;
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
