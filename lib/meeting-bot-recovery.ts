import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import type { SupportedMeetingPlatform } from "@/lib/meeting-links";
import { MEETING_BOT_RECOVERY_WINDOW_MS } from "@/lib/meeting-bot-recovery-policy";
import { getMeetingManagerCondition } from "@/lib/meeting-write-policy";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
  type WorkspaceContext,
} from "@/lib/workspace";

export type MeetingBotRecoveryCandidate = {
  calendarEventId: string | null;
  endedAt: string | null;
  id: string;
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
  const meetings = await findRecoverableMeetings({
    now: input.now ?? new Date(),
    workspace,
  });

  return meetings.map((meeting) => ({
    calendarEventId: meeting.calendarEventId,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    id: meeting.id,
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
  const [meeting] = await findRecoverableMeetings({
    meetingId: input.meetingId,
    now: input.now ?? new Date(),
    workspace,
  });

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

  return { meetingId: meeting.id, teamId: workspace.teamId };
}

async function findRecoverableMeetings(input: {
  meetingId?: string;
  now: Date;
  workspace: WorkspaceContext;
}) {
  const windowStart = new Date(
    input.now.getTime() - MEETING_BOT_RECOVERY_WINDOW_MS,
  );
  const recoveryAnchor = sql`greatest(
    coalesce(${meetings.endedAt}, ${meetings.startedAt}),
    ${meetings.updatedAt}
  )`;
  const conditions = [
    eq(meetings.teamId, input.workspace.teamId),
    getMeetingManagerCondition(input.workspace),
    inArray(meetings.status, ["failed", "missed"]),
    inArray(meetings.platform, ["google_meet", "zoom"]),
    sql`${meetings.startedAt} is not null`,
    sql`${meetings.startedAt} <= ${input.now}`,
    sql`${recoveryAnchor} >= ${windowStart}`,
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
    meeting.startedAt ? [{ ...meeting, startedAt: meeting.startedAt }] : [],
  );
}
