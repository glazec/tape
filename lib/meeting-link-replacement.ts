import { and, eq, inArray, or } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import {
  getMeetingBotMetadata,
  getMeetingBotRecallCreateInput,
} from "@/lib/meeting-bot-profile";
import { getBotProfileForMeeting } from "@/lib/meeting-bot-record-profile";
import { retireScheduledRecallBot } from "@/lib/meeting-bot-retirement";
import {
  buildAppUrl,
  detectBotSupportedMeetingPlatform,
  resolveMeetingJoinUrl,
} from "@/lib/meeting-links";
import { getMeetingManagerCondition } from "@/lib/meeting-write-policy";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import { scheduleRecallBot } from "@/lib/vendors/recall";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export { canReplaceMeetingLink } from "@/lib/meeting-link-replacement-policy";

// Recall needs a little lead time to schedule rather than dispatch.
const SCHEDULED_JOIN_MIN_LEAD_MS = 10 * 60 * 1_000;

export class MeetingLinkReplacementUnavailableError extends Error {
  constructor() {
    super("This meeting has already started recording");
    this.name = "MeetingLinkReplacementUnavailableError";
  }
}

export class UnsupportedMeetingLinkError extends Error {
  constructor() {
    super("Use a Google Meet or Zoom link");
    this.name = "UnsupportedMeetingLinkError";
  }
}

export class SameMeetingLinkError extends Error {
  constructor() {
    super("The bot is already using this link");
    this.name = "SameMeetingLinkError";
  }
}

// A link can change while nothing has been recorded: before the meeting
// starts, or while the host still holds the bot in the waiting room.
function getReplaceableMeetingCondition() {
  return or(
    eq(meetings.status, "scheduled"),
    and(
      eq(meetings.status, "recording"),
      eq(meetings.botState, "waiting_room"),
    ),
  )!;
}

export async function replaceMeetingLink(input: {
  meetingId: string;
  meetingUrl: string;
  sessionUser: SessionUser;
  now?: Date;
}) {
  const platform = detectBotSupportedMeetingPlatform(input.meetingUrl);

  if (!platform) {
    throw new UnsupportedMeetingLinkError();
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(
    input.sessionUser,
    { meetingId: input.meetingId },
  );
  await assertCanCreateMeetings(workspace);
  await assertWorkspaceHasProviderCredit(workspace);

  const meetingCondition = and(
    eq(meetings.id, input.meetingId),
    eq(meetings.teamId, workspace.teamId),
    inArray(meetings.platform, ["google_meet", "microsoft_teams", "zoom"]),
    getReplaceableMeetingCondition(),
    getMeetingManagerCondition(workspace),
  );
  const [meeting] = await db
    .select({
      calendarEventId: meetings.calendarEventId,
      id: meetings.id,
      meetingUrl: meetings.meetingUrl,
      recallBotId: meetings.recallBotId,
      startedAt: meetings.startedAt,
    })
    .from(meetings)
    .where(meetingCondition)
    .limit(1);

  if (!meeting) {
    throw new MeetingLinkReplacementUnavailableError();
  }

  const meetingUrl = await resolveMeetingJoinUrl(input.meetingUrl);

  if (meeting.meetingUrl === meetingUrl && meeting.recallBotId) {
    throw new SameMeetingLinkError();
  }

  const now = input.now ?? new Date();
  const startAt =
    meeting.startedAt &&
    meeting.startedAt.getTime() - now.getTime() > SCHEDULED_JOIN_MIN_LEAD_MS
      ? meeting.startedAt.toISOString()
      : undefined;
  const botProfile = await getBotProfileForMeeting(meeting.id);
  const response = (await scheduleRecallBot({
    meetingUrl,
    ...getMeetingBotRecallCreateInput(botProfile),
    ...(startAt ? { startAt } : {}),
    webhookUrl: buildAppUrl("/api/recall/webhook"),
    metadata: {
      ...getMeetingBotMetadata(botProfile),
      ...(meeting.calendarEventId
        ? { calendarEventId: meeting.calendarEventId }
        : {}),
      meetingId: meeting.id,
    },
  })) as { id?: unknown };

  if (typeof response.id !== "string") {
    throw new Error("Recall bot response missing id");
  }

  const newBotId = response.id;
  let updated: { id: string }[];

  try {
    // Re-check the state: a recording that began while the new bot was being
    // created must keep its original bot.
    updated = await db
      .update(meetings)
      .set({
        botDisplayName: botProfile.botName,
        botState: null,
        meetingUrl,
        meetingUrlSource: "manual",
        platform,
        recallBotId: newBotId,
        recallRecordingId: null,
        status: "scheduled",
        updatedAt: new Date(),
      })
      .where(meetingCondition)
      .returning({ id: meetings.id });
  } catch (error) {
    await retireScheduledRecallBot(newBotId).catch(() => undefined);
    throw error;
  }

  if (updated.length === 0) {
    await retireScheduledRecallBot(newBotId).catch(() => undefined);
    throw new MeetingLinkReplacementUnavailableError();
  }

  // Webhooks from the old bot are ignored once the meeting points at the new
  // one, so a failed cleanup cannot corrupt the meeting.
  if (meeting.recallBotId && meeting.recallBotId !== newBotId) {
    await retireScheduledRecallBot(meeting.recallBotId).catch((error) => {
      console.error("meeting_link_replacement_old_bot_cleanup_failure", {
        botId: meeting.recallBotId,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        meetingId: meeting.id,
      });
    });
  }

  return {
    botId: newBotId,
    meetingId: meeting.id,
    meetingUrl,
    platform,
    status: startAt ? ("scheduled" as const) : ("joining" as const),
  };
}
