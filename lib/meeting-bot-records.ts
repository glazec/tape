import { and, asc, eq, gte, ilike, or } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarEvents, meetings } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import type { SupportedMeetingPlatform } from "@/lib/meeting-links";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

type CreateScheduledMeetingBotInput = {
  sessionUser: SessionUser;
  meetingUrl: string;
  platform: SupportedMeetingPlatform;
  now?: Date;
};

/**
 * A meeting URL that matches more than one upcoming calendar event is
 * ambiguous — typically a personal meeting room or a recurring link reused
 * across many events. For those we can only trust a match that starts soon;
 * otherwise we would schedule the bot days out (or into an empty room) when
 * the user expects it to join the current call. A URL that matches exactly
 * one upcoming event is unambiguous, so we honor it at any lead time and
 * preserve the "paste a link to pre-schedule the bot" workflow.
 */
const AMBIGUOUS_MATCH_WINDOW_MS = 30 * 60 * 1_000;

export async function createScheduledMeetingBot(
  input: CreateScheduledMeetingBotInput,
) {
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);
  const now = input.now ?? new Date();
  const upcomingCalendarEvents = await findUpcomingCalendarEventsByMeetingUrl({
    meetingUrl: input.meetingUrl,
    teamId: workspace.teamId,
  });
  const earliestEvent = upcomingCalendarEvents[0] ?? null;
  const isAmbiguousMatch = upcomingCalendarEvents.length > 1;
  const calendarEvent =
    earliestEvent &&
    (!isAmbiguousMatch ||
      earliestEvent.startsAt.getTime() - now.getTime() <=
        AMBIGUOUS_MATCH_WINDOW_MS)
      ? earliestEvent
      : null;

  if (calendarEvent) {
    const existingMeeting = await findMeetingForCalendarEvent({
      calendarEventId: calendarEvent.id,
      teamId: workspace.teamId,
    });

    if (existingMeeting) {
      await db
        .update(meetings)
        .set({
          meetingUrl: input.meetingUrl,
          platform: input.platform,
          status: "scheduled",
          title: calendarEvent.title,
          startedAt: calendarEvent.startsAt,
          endedAt: calendarEvent.endsAt,
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, existingMeeting.id));

      await reconcileMeetingSharingForMeeting(existingMeeting.id);

      return {
        meetingId: existingMeeting.id,
        teamId: workspace.teamId,
        startAt: calendarEvent.startsAt.toISOString(),
        ...(existingMeeting.status === "scheduled" && existingMeeting.recallBotId
          ? { recallBotId: existingMeeting.recallBotId }
          : {}),
      };
    }

    const [meeting] = await db
      .insert(meetings)
      .values({
        teamId: workspace.teamId,
        ownerUserId: workspace.userId,
        calendarEventId: calendarEvent.id,
        title: calendarEvent.title,
        platform: input.platform,
        status: "scheduled",
        meetingUrl: input.meetingUrl,
        startedAt: calendarEvent.startsAt,
        endedAt: calendarEvent.endsAt,
      })
      .returning({ id: meetings.id });

    await reconcileMeetingSharingForMeeting(meeting.id);

    return {
      meetingId: meeting.id,
      teamId: workspace.teamId,
      startAt: calendarEvent.startsAt.toISOString(),
    };
  }

  const [meeting] = await db
    .insert(meetings)
    .values({
      teamId: workspace.teamId,
      ownerUserId: workspace.userId,
      title: defaultMeetingTitle(input.platform),
      platform: input.platform,
      status: "scheduled",
      meetingUrl: input.meetingUrl,
    })
    .returning({ id: meetings.id });

  await reconcileMeetingSharingForMeeting(meeting.id);

  return { meetingId: meeting.id, teamId: workspace.teamId };
}

export async function markMeetingBotScheduled(input: {
  meetingId: string;
  recallBotId: string;
}) {
  await db
    .update(meetings)
    .set({
      recallBotId: input.recallBotId,
      status: "scheduled",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
}

export async function markMeetingBotFailed(input: { meetingId: string }) {
  await db
    .update(meetings)
    .set({
      status: "failed",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
}

function defaultMeetingTitle(platform: SupportedMeetingPlatform) {
  return platform === "google_meet" ? "Google Meet recording" : "Zoom recording";
}

async function findUpcomingCalendarEventsByMeetingUrl(input: {
  teamId: string;
  meetingUrl: string;
}) {
  // Two rows is enough to tell "exactly one match" from "ambiguous".
  return db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      meetingUrl: calendarEvents.meetingUrl,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
    })
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.teamId, input.teamId),
        gte(calendarEvents.startsAt, new Date()),
        or(...buildMeetingUrlMatchConditions(input.meetingUrl)),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(2);
}

function buildMeetingUrlMatchConditions(meetingUrl: string) {
  const conditions = [
    eq(calendarEvents.meetingUrl, meetingUrl),
    eq(calendarEvents.location, meetingUrl),
    ilike(calendarEvents.description, `%${meetingUrl}%`),
  ];
  const pathToken = getMeetingUrlPathToken(meetingUrl);

  if (pathToken) {
    conditions.push(
      ilike(calendarEvents.meetingUrl, `%${pathToken}%`),
      ilike(calendarEvents.location, `%${pathToken}%`),
      ilike(calendarEvents.description, `%${pathToken}%`),
    );
  }

  return conditions;
}

function getMeetingUrlPathToken(meetingUrl: string) {
  let url: URL;

  try {
    url = new URL(meetingUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();

  if (
    (hostname === "zoom.us" || hostname.endsWith(".zoom.us")) &&
    url.pathname.startsWith("/j/")
  ) {
    const meetingId = url.pathname.split("/").filter(Boolean)[1];

    return meetingId ? `/j/${meetingId}` : null;
  }

  if (hostname === "meet.google.com") {
    return url.pathname.replace(/\/$/, "") || null;
  }

  return null;
}

async function findMeetingForCalendarEvent(input: {
  teamId: string;
  calendarEventId: string;
}) {
  const [meeting] = await db
    .select({
      id: meetings.id,
      recallBotId: meetings.recallBotId,
      status: meetings.status,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, input.teamId),
        eq(meetings.calendarEventId, input.calendarEventId),
      ),
    )
    .limit(1);

  return meeting ?? null;
}
