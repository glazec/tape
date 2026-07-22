import { and, asc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarEvents, meetings, transcriptSegments } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import type { SupportedMeetingPlatform } from "@/lib/meeting-links";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
import { getMeetingManagerCondition } from "@/lib/meeting-write-policy";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";

type CreateScheduledMeetingBotInput = {
  calendarEventId?: string;
  sessionUser: SessionUser;
  meetingUrl: string;
  platform: SupportedMeetingPlatform;
  now?: Date;
  skipCalendarMatch?: boolean;
};

export type ScheduledMeetingBotCalendarCandidate = {
  action: "join" | "schedule";
  calendarEventId: string;
  endedAt: string | null;
  startedAt: string;
  title: string;
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
const EARLY_MEETING_WINDOW_MS = 30 * 60 * 1_000;
const LATE_MEETING_GRACE_MS = 15 * 60 * 1_000;

export async function createScheduledMeetingBot(
  input: CreateScheduledMeetingBotInput,
) {
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);
  const now = input.now ?? new Date();
  const calendarEvent = input.calendarEventId
    ? (
        await findNearbyCalendarEvents({
          calendarEventId: input.calendarEventId,
          now,
          workspace,
        })
      )[0] ?? null
    : input.skipCalendarMatch
      ? null
      : await findCalendarEventMatch({
          meetingUrl: input.meetingUrl,
          now,
          teamId: workspace.teamId,
        });

  if (input.calendarEventId && !calendarEvent) {
    throw new Error("Calendar meeting match is no longer available");
  }

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

export async function findScheduledMeetingBotCalendarCandidates(input: {
  now?: Date;
  sessionUser: SessionUser;
}): Promise<ScheduledMeetingBotCalendarCandidate[]> {
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);
  const calendarEvents = await findNearbyCalendarEvents({
    now: input.now ?? new Date(),
    workspace,
  });

  return Promise.all(
    calendarEvents.map(async (calendarEvent) => {
      const existingMeeting = await findMeetingForCalendarEvent({
        calendarEventId: calendarEvent.id,
        teamId: workspace.teamId,
      });

      return {
        action:
          existingMeeting?.status === "scheduled" && existingMeeting.recallBotId
            ? ("join" as const)
            : ("schedule" as const),
        calendarEventId: calendarEvent.id,
        endedAt: calendarEvent.endsAt?.toISOString() ?? null,
        startedAt: calendarEvent.startsAt.toISOString(),
        title: calendarEvent.title,
      };
    }),
  );
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
  now: Date;
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
        gte(calendarEvents.startsAt, input.now),
        or(...buildMeetingUrlMatchConditions(input.meetingUrl)),
      ),
    )
    .orderBy(asc(calendarEvents.startsAt))
    .limit(2);
}

async function findNearbyCalendarEvents(input: {
  calendarEventId?: string;
  now: Date;
  workspace: WorkspaceContext;
}) {
  const conditions = [
    eq(calendarEvents.teamId, input.workspace.teamId),
    lte(
      calendarEvents.startsAt,
      new Date(input.now.getTime() + EARLY_MEETING_WINDOW_MS),
    ),
    gte(
      sql`coalesce(
        ${calendarEvents.endsAt},
        ${calendarEvents.startsAt} + interval '1 hour'
      )`,
      new Date(input.now.getTime() - LATE_MEETING_GRACE_MS),
    ),
    sql`exists (
      select 1
      from ${meetings}
      where ${meetings.calendarEventId} = ${calendarEvents.id}
        and ${inArray(meetings.status, ["scheduled", "failed", "missed"])}
        and ${getMeetingManagerCondition(input.workspace)}
        and not exists (
          select 1
          from ${transcriptSegments}
          where ${transcriptSegments.meetingId} = ${meetings.id}
        )
    )`,
  ];

  if (input.calendarEventId) {
    conditions.push(eq(calendarEvents.id, input.calendarEventId));
  }

  const events = await db
    .select({
      id: calendarEvents.id,
      title: calendarEvents.title,
      teamMeetingKey: calendarEvents.teamMeetingKey,
      meetingUrl: calendarEvents.meetingUrl,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
    })
    .from(calendarEvents)
    .where(and(...conditions))
    .orderBy(asc(calendarEvents.startsAt))
    .limit(input.calendarEventId ? 1 : 10);

  const seen = new Set<string>();

  return events.filter((event) => {
    if (!isPotentialMeetingTiming(event, input.now)) {
      return false;
    }

    const key =
      event.teamMeetingKey ??
      `${event.title}\u0000${event.startsAt.toISOString()}\u0000${event.endsAt?.toISOString() ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function isPotentialMeetingTiming(
  event: { endsAt: Date | null; startsAt: Date },
  now: Date,
) {
  const latestStart = now.getTime() + EARLY_MEETING_WINDOW_MS;
  const earliestEnd = now.getTime() - LATE_MEETING_GRACE_MS;
  const eventEnd =
    event.endsAt?.getTime() ?? event.startsAt.getTime() + 60 * 60 * 1_000;

  return event.startsAt.getTime() <= latestStart && eventEnd >= earliestEnd;
}

async function findCalendarEventMatch(input: {
  meetingUrl: string;
  now: Date;
  teamId: string;
}) {
  const upcomingCalendarEvents = await findUpcomingCalendarEventsByMeetingUrl(
    input,
  );
  const earliestEvent = upcomingCalendarEvents[0] ?? null;
  const isAmbiguousMatch = upcomingCalendarEvents.length > 1;

  return earliestEvent &&
    (!isAmbiguousMatch ||
      earliestEvent.startsAt.getTime() - input.now.getTime() <=
        AMBIGUOUS_MATCH_WINDOW_MS)
    ? earliestEvent
    : null;
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
        inArray(meetings.status, ["scheduled", "failed", "missed"]),
      ),
    )
    .limit(1);

  return meeting ?? null;
}
