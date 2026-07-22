import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  createScheduledMeetingBot,
  findScheduledMeetingBotCalendarCandidates,
  markMeetingBotFailed,
  markMeetingBotScheduled,
} from "@/lib/meeting-bot-records";
import { joinScheduledMeetingBotNow } from "@/lib/meeting-bot-join";
import {
  findMeetingBotRecoveryCandidates,
  prepareMeetingBotRecovery,
} from "@/lib/meeting-bot-recovery";
import {
  buildAppUrl,
  detectMeetingPlatform,
  resolveMeetingJoinUrl,
} from "@/lib/meeting-links";
import {
  getMeetingBotMetadata,
  getMeetingBotProfile,
  getMeetingBotRecallCreateInput,
} from "@/lib/meeting-bot-profile";
import { scheduleRecallBot } from "@/lib/vendors/recall";
import { SharedOnlyAccessError } from "@/lib/access-errors";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  calendarEventId: z.uuid().optional(),
  createSeparateMeeting: z.boolean().optional(),
  meetingUrl: z.url(),
  recoveryMeetingId: z.uuid().optional(),
}).refine(
  (value) =>
    [
      Boolean(value.calendarEventId),
      value.createSeparateMeeting === true,
      Boolean(value.recoveryMeetingId),
    ].filter(Boolean).length <= 1,
  { message: "Choose one meeting destination" },
);

type RecallBotResponse = {
  id?: unknown;
};

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const result = requestSchema.safeParse(body);

  if (!result.success) {
    return Response.json({ error: "Invalid meeting link" }, { status: 400 });
  }

  const platform = detectMeetingPlatform(result.data.meetingUrl);

  if (!platform) {
    return Response.json(
      { error: "Unsupported meeting link" },
      { status: 400 },
    );
  }

  const meetingUrl = await resolveMeetingJoinUrl(result.data.meetingUrl);
  const isRecovery = Boolean(result.data.recoveryMeetingId);
  const hasMeetingChoice = Boolean(
    result.data.calendarEventId ||
      result.data.createSeparateMeeting ||
      result.data.recoveryMeetingId,
  );
  let scheduledMeeting: {
    meetingId: string;
    teamId: string;
    startAt?: string;
    recallBotId?: string;
  };
  let skipUnconfirmedCalendarMatch = false;

  try {
    if (!hasMeetingChoice) {
      const now = new Date();
      const [calendarMeetings, recentMeetings] = await Promise.all([
        findScheduledMeetingBotCalendarCandidates({
          now,
          sessionUser: user,
        }),
        findMeetingBotRecoveryCandidates({ now, sessionUser: user }),
      ]);
      const recentCalendarEventIds = new Set(
        recentMeetings.flatMap((meeting) =>
          meeting.calendarEventId ? [meeting.calendarEventId] : [],
        ),
      );
      const potentialMeetings = [
        ...recentMeetings.map((meeting) => ({
          action: "join" as const,
          endedAt: meeting.endedAt,
          id: meeting.id,
          kind: "recent" as const,
          startedAt: meeting.startedAt,
          title: meeting.title,
        })),
        ...calendarMeetings
          .filter(
            (meeting) =>
              !recentCalendarEventIds.has(meeting.calendarEventId),
          )
          .map((meeting) => ({
            action: meeting.action,
            endedAt: meeting.endedAt,
            id: meeting.calendarEventId,
            kind: "calendar" as const,
            startedAt: meeting.startedAt,
            title: meeting.title,
          })),
      ];
      const nearbyMeetings = selectBackToBackMeetings(potentialMeetings, now);
      skipUnconfirmedCalendarMatch = potentialMeetings.length > 0;

      if (nearbyMeetings.length > 0) {
        return Response.json(
          {
            code: "potential_meetings_detected",
            potentialMeetings: nearbyMeetings,
          },
          { status: 409 },
        );
      }
    }

    scheduledMeeting = result.data.recoveryMeetingId
      ? await prepareMeetingBotRecovery({
          meetingId: result.data.recoveryMeetingId,
          meetingUrl,
          platform,
          sessionUser: user,
        })
      : await createScheduledMeetingBot({
          ...(result.data.calendarEventId
            ? { calendarEventId: result.data.calendarEventId }
            : {}),
          sessionUser: user,
          meetingUrl,
          platform,
          ...(result.data.createSeparateMeeting ||
          skipUnconfirmedCalendarMatch
            ? { skipCalendarMatch: true }
            : {}),
        });
  } catch (error) {
    console.error("meeting_link_scheduling_failure", {
      errorMessage: getErrorMessage(error),
      phase: "create_meeting",
      platform,
      userId: user.id,
    });
    const response = handleMeetingLinkError(error);

    if (response) {
      return response;
    }

    return Response.json({ error: "Meeting unavailable" }, { status: 500 });
  }

  if (scheduledMeeting.recallBotId) {
    try {
      const joinedMeeting = await joinScheduledMeetingBotNow({
        meetingId: scheduledMeeting.meetingId,
        sessionUser: user,
      });

      return Response.json({
        botId: joinedMeeting.botId,
        meetingId: scheduledMeeting.meetingId,
        meetingUrl,
        platform,
        status: "joining",
      });
    } catch (error) {
      console.error("meeting_link_scheduling_failure", {
        errorMessage: getErrorMessage(error),
        meetingId: scheduledMeeting.meetingId,
        phase: "join_existing_bot",
        platform,
        userId: user.id,
      });

      return Response.json(
        { error: "Meeting bot could not join" },
        { status: 502 },
      );
    }
  }

  try {
    const botProfile = await getMeetingBotProfile(scheduledMeeting.teamId);
    const bot = (await scheduleRecallBot({
      meetingUrl,
      ...getMeetingBotRecallCreateInput(botProfile),
      ...(scheduledMeeting.startAt ? { startAt: scheduledMeeting.startAt } : {}),
      webhookUrl: buildAppUrl("/api/recall/webhook"),
      metadata: {
        ...getMeetingBotMetadata(botProfile),
        meetingId: scheduledMeeting.meetingId,
      },
    })) as RecallBotResponse;

    if (typeof bot.id !== "string") {
      throw new Error("Recall bot response missing id");
    }

    await markMeetingBotScheduled({
      meetingId: scheduledMeeting.meetingId,
      recallBotId: bot.id,
    });

    return Response.json({
      botId: bot.id,
      meetingId: scheduledMeeting.meetingId,
      meetingUrl,
      platform,
      status: isRecovery ? "joining" : "scheduled",
    });
  } catch (error) {
    console.error("meeting_link_scheduling_failure", {
      errorMessage: getErrorMessage(error),
      meetingId: scheduledMeeting.meetingId,
      phase: "schedule_recall_bot",
      platform,
      userId: user.id,
    });
    await markMeetingBotFailed({ meetingId: scheduledMeeting.meetingId });

    return Response.json({ error: "Meeting bot unavailable" }, { status: 502 });
  }
}

type PotentialMeeting = {
  action: "join" | "schedule";
  endedAt: string | null;
  id: string;
  kind: "calendar" | "recent";
  startedAt: string;
  title: string;
};

function selectBackToBackMeetings(
  meetings: PotentialMeeting[],
  now: Date,
) {
  const nowMs = now.getTime();
  const candidates = meetings.flatMap((meeting) => {
    const startedAt = new Date(meeting.startedAt).getTime();
    const endedAt = meeting.endedAt
      ? new Date(meeting.endedAt).getTime()
      : startedAt + 60 * 60 * 1_000;

    return Number.isFinite(startedAt) && Number.isFinite(endedAt)
      ? [{ ...meeting, endedAtMs: endedAt, startedAtMs: startedAt }]
      : [];
  });
  const previous = candidates
    .filter((meeting) => meeting.endedAtMs < nowMs)
    .sort((left, right) => right.endedAtMs - left.endedAtMs)[0];
  const current = candidates
    .filter(
      (meeting) =>
        meeting.startedAtMs <= nowMs && meeting.endedAtMs >= nowMs,
    )
    .sort((left, right) => right.startedAtMs - left.startedAtMs)[0];
  const next = candidates
    .filter((meeting) => meeting.startedAtMs > nowMs)
    .sort((left, right) => left.startedAtMs - right.startedAtMs)[0];
  const seen = new Set<string>();

  return [
    previous ? { ...previous, timing: "past" as const } : null,
    current ? { ...current, timing: "current" as const } : null,
    next ? { ...next, timing: "future" as const } : null,
  ].flatMap((meeting) => {
    if (!meeting || seen.has(`${meeting.kind}:${meeting.id}`)) {
      return [];
    }

    seen.add(`${meeting.kind}:${meeting.id}`);
    return [{
      action: meeting.action,
      endedAt: meeting.endedAt,
      id: meeting.id,
      kind: meeting.kind,
      startedAt: meeting.startedAt,
      timing: meeting.timing,
      title: meeting.title,
    }];
  });
}

function handleMeetingLinkError(error: unknown) {
  if (error instanceof SharedOnlyAccessError) {
    return Response.json(
      { error: "Shared users cannot add meetings" },
      { status: 403 },
    );
  }

  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown meeting link error";
}
