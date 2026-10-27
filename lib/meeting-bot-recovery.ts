import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, recordings, transcriptSegments } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import type { SupportedMeetingPlatform } from "@/lib/meeting-links";
import {
  FAILED_MEETING_BOT_RECOVERY_WINDOW_MS,
  MEETING_BOT_RECOVERY_WINDOW_MS,
  MEETING_CONTINUATION_WINDOW_MS,
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
  workspace?: WorkspaceContext;
  now?: Date;
}): Promise<MeetingBotRecoveryCandidate | null> {
  const meetings = await findMeetingBotRecoveryCandidates(input);

  return meetings[0] ?? null;
}

export async function findMeetingBotRecoveryCandidates(input: {
  sessionUser: SessionUser;
  workspace?: WorkspaceContext;
  now?: Date;
}): Promise<MeetingBotRecoveryCandidate[]> {
  const workspace = input.workspace ?? await getOrCreateWorkspaceForSessionUser(input.sessionUser);
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
  workspace?: WorkspaceContext;
  now?: Date;
}) {
  const workspace = input.workspace ?? await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);
  await assertWorkspaceHasProviderCredit(workspace);
  const now = input.now ?? new Date();
  const [recording] = await db.select({ id: recordings.id }).from(recordings)
    .where(sql`(${recordings.meetingId}=${input.meetingId} or ${recordings.meetingId} in
      (select source_meeting_id from meeting_parts where meeting_id=${input.meetingId}))`).limit(1);
  if (recording) {
    const { continueMeetingRecording } = await import("@/lib/meeting-continuation");
    await continueMeetingRecording(workspace, input.meetingId, input.meetingUrl);
    return { meetingId: input.meetingId, teamId: workspace.teamId, continued: true };
  }
  const [meeting] = await findRecoverableMeetings({ meetingId: input.meetingId, now, workspace });

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
    resumeRecording: false,
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
    inArray(meetings.status, ["processing", "ready", "failed"]),
    inArray(meetings.platform, ["google_meet", "zoom"]),
    sql`${meetings.startedAt} is not null`,
    sql`${meetings.startedAt} <= ${input.now}`,
    sql`exists (
      select 1 from ${recordings}
      where (${recordings.meetingId} = ${meetings.id} or ${recordings.meetingId} in
        (select source_meeting_id from meeting_parts where meeting_id = ${meetings.id}))
        and ${recordings.endedAt} is not null
        and ${recordings.endedAt} <= ${input.now}
        and ${recordings.endedAt} > ${new Date(input.now.getTime() - MEETING_CONTINUATION_WINDOW_MS)}
    )`,
    sql`not exists (select 1 from meeting_parts where source_meeting_id = ${meetings.id})`,
    sql`not exists (select 1 from meeting_parts p join meetings child on child.id=p.source_meeting_id
      where p.meeting_id=${meetings.id} and child.status in ('scheduled','recording'))`,
  ];

  if (input.meetingId) {
    conditions.push(eq(meetings.id, input.meetingId));
  }

  const rows = await db
    .select({
      botOrganizationDomain: meetings.botOrganizationDomain,
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
  const failedWindowStart = new Date(
    input.now.getTime() - FAILED_MEETING_BOT_RECOVERY_WINDOW_MS,
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
      and(
        eq(meetings.status, "failed"),
        sql`${recoveryAnchor} >= ${failedWindowStart}`,
      ),
      and(
        eq(meetings.status, "missed"),
        sql`${recoveryAnchor} >= ${windowStart}`,
      ),
    ),
    sql`${recoveryAnchor} <= ${input.now}`,
    sql`not exists (
      select 1 from ${transcriptSegments}
      where ${transcriptSegments.meetingId} = ${meetings.id}
    )`,
    sql`not exists (select 1 from recordings r where r.meeting_id=${meetings.id} or r.meeting_id in
      (select source_meeting_id from meeting_parts where meeting_id=${meetings.id}))`,
  ];

  if (input.meetingId) {
    conditions.push(eq(meetings.id, input.meetingId));
  }

  const rows = await db
    .select({
      botOrganizationDomain: meetings.botOrganizationDomain,
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
