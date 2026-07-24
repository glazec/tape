import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, recordings, transcriptSegments } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import type { SupportedMeetingPlatform } from "@/lib/meeting-links";
import {
  MEETING_BOT_RECOVERY_WINDOW_MS,
  MEETING_RECORDING_RESUME_MIN_REMAINING_MS,
} from "@/lib/meeting-bot-recovery-policy";
import { getMeetingManagerCondition } from "@/lib/meeting-write-policy";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";

export type MeetingBotRecoveryCandidate = {
  calendarEventId: string | null;
  endedAt: string | null;
  id: string;
  mode: "recover" | "resume";
  startedAt: string;
  title: string;
};

export async function findMeetingBotRecoveryCandidate(input: {
  sessionUser: SessionUser;
  now?: Date;
}): Promise<MeetingBotRecoveryCandidate | null> {
  const meetings = await findMeetingBotRecoveryCandidates(input);

  return meetings[0] ?? null;
}

export async function findMeetingBotRecoveryCandidates(input: {
  sessionUser: SessionUser;
  now?: Date;
}): Promise<MeetingBotRecoveryCandidate[]> {
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);
  await assertWorkspaceHasProviderCredit(workspace);
  const now = input.now ?? new Date();
  const [resumableMeetings, recoverableMeetings] = await Promise.all([
    findResumableMeetings({ now, workspace }),
    findRecoverableMeetings({ now, workspace }),
  ]);
  const meetings = [...resumableMeetings, ...recoverableMeetings].sort(
    (left, right) => right.startedAt.getTime() - left.startedAt.getTime(),
  );

  return meetings.map((meeting) => ({
    calendarEventId: meeting.calendarEventId,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    id: meeting.id,
    mode: meeting.mode,
    startedAt: meeting.startedAt.toISOString(),
    title: meeting.title,
  }));
}

export async function prepareMeetingBotRecovery(input: {
  meetingId: string;
  meetingUrl: string;
  platform: SupportedMeetingPlatform;
  sessionUser: SessionUser;
  now?: Date;
}) {
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);
  await assertWorkspaceHasProviderCredit(workspace);
  const now = input.now ?? new Date();
  const [resumableMeeting] = await findResumableMeetings({
    meetingId: input.meetingId,
    now,
    workspace,
  });
  const [recoverableMeeting] = resumableMeeting
    ? []
    : await findRecoverableMeetings({
        meetingId: input.meetingId,
        now,
        workspace,
      });
  const meeting = resumableMeeting ?? recoverableMeeting;

  if (!meeting) {
    throw new Error("Meeting is no longer available for bot recovery");
  }

  await db
    .update(meetings)
    .set({
      meetingUrl: input.meetingUrl,
      platform: input.platform,
      recallBotId: null,
      status: "scheduled",
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, meeting.id));

  return {
    meetingId: meeting.id,
    resumeRecording: meeting.mode === "resume",
    teamId: workspace.teamId,
  };
}

async function findResumableMeetings(input: {
  meetingId?: string;
  now: Date;
  workspace: WorkspaceContext;
}) {
  const conditions = [
    eq(meetings.teamId, input.workspace.teamId),
    getMeetingManagerCondition(input.workspace),
    inArray(meetings.status, ["processing", "ready"]),
    inArray(meetings.platform, ["google_meet", "zoom"]),
    sql`${meetings.startedAt} is not null`,
    sql`${meetings.startedAt} <= ${input.now}`,
    sql`${meetings.endedAt} >= ${new Date(
      input.now.getTime() + MEETING_RECORDING_RESUME_MIN_REMAINING_MS,
    )}`,
    sql`exists (
      select 1 from ${recordings}
      where ${recordings.meetingId} = ${meetings.id}
        and ${recordings.endedAt} is not null
        and ${recordings.endedAt} <= ${input.now}
    )`,
  ];

  if (input.meetingId) {
    conditions.push(eq(meetings.id, input.meetingId));
  }

  const rows = await db
    .select({
      calendarEventId: meetings.calendarEventId,
      endedAt: meetings.endedAt,
      id: meetings.id,
      startedAt: meetings.startedAt,
      title: meetings.title,
    })
    .from(meetings)
    .where(and(...conditions))
    .orderBy(desc(meetings.startedAt))
    .limit(input.meetingId ? 1 : 5);

  return rows.flatMap((meeting) =>
    meeting.startedAt
      ? [{ ...meeting, mode: "resume" as const, startedAt: meeting.startedAt }]
      : [],
  );
}

async function findRecoverableMeetings(input: {
  meetingId?: string;
  now: Date;
  workspace: WorkspaceContext;
}) {
  const windowStart = new Date(
    input.now.getTime() - MEETING_BOT_RECOVERY_WINDOW_MS,
  );
  const recoveryAnchor = meetings.updatedAt;
  const activeWindowEnd = new Date(
    input.now.getTime() + MEETING_RECORDING_RESUME_MIN_REMAINING_MS,
  );
  const conditions = [
    eq(meetings.teamId, input.workspace.teamId),
    getMeetingManagerCondition(input.workspace),
    inArray(meetings.status, ["failed", "missed"]),
    inArray(meetings.platform, ["google_meet", "zoom"]),
    sql`${meetings.startedAt} is not null`,
    sql`${meetings.startedAt} <= ${input.now}`,
    or(
      and(
        sql`${meetings.endedAt} is not null`,
        sql`${meetings.endedAt} >= ${activeWindowEnd}`,
      ),
      sql`${recoveryAnchor} >= ${windowStart}`,
    ),
    sql`${recoveryAnchor} <= ${input.now}`,
    sql`not exists (
      select 1 from ${transcriptSegments}
      where ${transcriptSegments.meetingId} = ${meetings.id}
    )`,
  ];

  if (input.meetingId) {
    conditions.push(eq(meetings.id, input.meetingId));
  }

  const rows = await db
    .select({
      calendarEventId: meetings.calendarEventId,
      endedAt: meetings.endedAt,
      id: meetings.id,
      startedAt: meetings.startedAt,
      title: meetings.title,
    })
    .from(meetings)
    .where(and(...conditions))
    .orderBy(desc(recoveryAnchor))
    .limit(input.meetingId ? 1 : 5);

  return rows.flatMap((meeting) =>
    meeting.startedAt
      ? [{ ...meeting, mode: "recover" as const, startedAt: meeting.startedAt }]
      : [],
  );
}
