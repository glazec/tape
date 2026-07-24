import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calendarConnections, calendarEvents, meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";
import type { SessionUser } from "@/lib/auth";
import { markMeetingBotScheduled } from "@/lib/meeting-bot-records";
import {
  getMeetingBotMetadata,
  getMeetingBotProfile,
  getMeetingBotRecallCreateInput,
} from "@/lib/meeting-bot-profile";
import { buildAppUrl } from "@/lib/meeting-links";
import {
  deleteScheduledRecallBot,
  listRecallCalendarEvents,
  scheduleRecallBot,
  scheduleRecallCalendarEventBot,
} from "@/lib/vendors/recall";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

const IMMEDIATE_CALENDAR_JOIN_LEAD_MS = 10 * 1_000;

export class MeetingBotJoinUnavailableError extends Error {
  constructor() {
    super("Meeting bot is no longer scheduled");
    this.name = "MeetingBotJoinUnavailableError";
  }
}

export async function joinScheduledMeetingBotNow(input: {
  meetingId: string;
  sessionUser: SessionUser;
  now?: Date;
}) {
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);
  await assertWorkspaceHasProviderCredit(workspace);

  const [meeting] = await db
    .select({
      calendarEventId: meetings.calendarEventId,
      externalCalendarEventId: calendarEvents.externalEventId,
      id: meetings.id,
      meetingUrl: meetings.meetingUrl,
      recallBotId: meetings.recallBotId,
      recallCalendarId: calendarConnections.recallCalendarId,
      startedAt: meetings.startedAt,
      teamId: meetings.teamId,
      teamMeetingKey: meetings.teamMeetingKey,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .leftJoin(
      calendarConnections,
      eq(calendarConnections.id, calendarEvents.connectionId),
    )
    .where(
      and(
        eq(meetings.id, input.meetingId),
        eq(meetings.teamId, workspace.teamId),
        eq(meetings.status, "scheduled"),
      ),
    )
    .limit(1);

  if (!meeting?.meetingUrl || !meeting.recallBotId) {
    throw new MeetingBotJoinUnavailableError();
  }

  const botProfile = await getMeetingBotProfile(meeting.teamId);
  const metadata = {
    ...getMeetingBotMetadata(botProfile),
    ...(meeting.calendarEventId
      ? { calendarEventId: meeting.calendarEventId }
      : {}),
    meetingId: meeting.id,
  };
  let activeBotId = meeting.recallBotId;

  if (meeting.recallCalendarId && meeting.externalCalendarEventId) {
    const recallCalendarEventId = await findRecallCalendarEventId({
      externalCalendarEventId: meeting.externalCalendarEventId,
      recallCalendarId: meeting.recallCalendarId,
      startedAt: meeting.startedAt,
    });
    const deduplicationKey = meeting.teamMeetingKey ?? recallCalendarEventId;
    const response = await scheduleRecallCalendarEventBot({
      calendarEventId: recallCalendarEventId,
      deduplicationKey,
      ...getMeetingBotRecallCreateInput(botProfile),
      joinAt: new Date(
        (input.now ?? new Date()).getTime() + IMMEDIATE_CALENDAR_JOIN_LEAD_MS,
      ).toISOString(),
      metadata,
    });
    const botId = getRecallCalendarBotId(response, deduplicationKey);

    if (!botId) {
      throw new Error("Recall calendar bot response missing id");
    }

    if (botId !== meeting.recallBotId) {
      try {
        await markMeetingBotScheduled({
          meetingId: meeting.id,
          recallBotId: botId,
        });
      } catch (error) {
        await deleteScheduledRecallBot({ botId }).catch(() => undefined);
        throw error;
      }
      activeBotId = botId;
      await retireRecallBot(meeting.recallBotId);
    }
  } else {
    const response = (await scheduleRecallBot({
      meetingUrl: meeting.meetingUrl,
      ...getMeetingBotRecallCreateInput(botProfile),
      webhookUrl: buildAppUrl("/api/recall/webhook"),
      metadata,
    })) as { id?: unknown };

    if (typeof response.id !== "string") {
      throw new Error("Recall bot response missing id");
    }

    try {
      await markMeetingBotScheduled({
        meetingId: meeting.id,
        recallBotId: response.id,
      });
    } catch (error) {
      await deleteScheduledRecallBot({ botId: response.id }).catch(
        () => undefined,
      );
      throw error;
    }
    activeBotId = response.id;
    await retireRecallBot(meeting.recallBotId);
  }

  return { botId: activeBotId, meetingId: meeting.id };
}

async function retireRecallBot(botId: string) {
  let retryQueued = false;

  try {
    await inngest.send({
      id: `delete-recall-bot:${botId}`,
      name: "meeting/delete.recall-bot",
      data: { botId },
    });
    retryQueued = true;
  } catch {
    // The direct delete below is still authoritative when queueing is down.
  }

  try {
    await deleteScheduledRecallBot({ botId });
  } catch (error) {
    if (!retryQueued) {
      throw error;
    }
  }
}

async function findRecallCalendarEventId(input: {
  externalCalendarEventId: string;
  recallCalendarId: string;
  startedAt: Date | null;
}) {
  const startTimeGte = input.startedAt
    ? new Date(input.startedAt.getTime() - 60 * 60 * 1_000).toISOString()
    : undefined;
  const events = await listRecallCalendarEvents({
    calendarId: input.recallCalendarId,
    ...(startTimeGte ? { startTimeGte } : {}),
  });
  const event = events.find((value) => {
    const candidate = getRecord(value);

    return candidate?.platform_id === input.externalCalendarEventId;
  });
  const eventId = getRecord(event)?.id;

  if (typeof eventId !== "string" || !eventId) {
    throw new MeetingBotJoinUnavailableError();
  }

  return eventId;
}

function getRecallCalendarBotId(value: unknown, deduplicationKey: string) {
  const bots = getRecord(value)?.bots;

  if (!Array.isArray(bots)) {
    return null;
  }

  for (const bot of bots) {
    const candidate = getRecord(bot);

    if (
      candidate?.deduplication_key === deduplicationKey &&
      typeof candidate.bot_id === "string"
    ) {
      return candidate.bot_id;
    }
  }

  return null;
}

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
