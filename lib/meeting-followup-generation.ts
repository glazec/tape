import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, users } from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import {
  FOLLOWUP_SOURCE_LIMIT,
  type MeetingFollowup,
} from "@/lib/meeting-followup";
import {
  getCurrentMeetingFollowup,
  getFollowupSource,
  getFollowupSourceHash,
  isFollowupReady,
} from "@/lib/meeting-followup-source";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import { generateMeetingFollowup } from "@/lib/vendors/openrouter";
import type { WorkspaceContext } from "@/lib/workspace";

type ComposedFollowupMeeting = NonNullable<
  Awaited<ReturnType<typeof getComposedMeetingForFollowup>>
>;

export type MeetingFollowupGenerationOutcome =
  | { status: "saved"; result: MeetingFollowup }
  | { status: "not_found" }
  | { status: "not_ready" }
  | { status: "too_long" }
  | { status: "transcript_changed" }
  | { status: "meeting_changed" };

/**
 * Generates the AI followup for a meeting the workspace can manage and saves
 * it against the transcript it was generated from. Shared by the on-demand
 * route and the job that runs when a transcript finishes, so both apply the
 * same readiness, size, credit, and concurrency checks.
 *
 * Provider and credit errors are thrown for the caller to report.
 */
export async function generateAndSaveMeetingFollowup({
  expectedSourceHash,
  meeting,
  meetingId,
  workspace,
}: {
  /** When set, generation stops if the transcript no longer matches it. */
  expectedSourceHash?: string;
  meeting: ComposedFollowupMeeting;
  meetingId: string;
  workspace: WorkspaceContext;
}): Promise<MeetingFollowupGenerationOutcome> {
  const source = getFollowupSource(meeting);
  const sourceHash = getFollowupSourceHash(source);

  if (!isFollowupReady(meeting)) {
    return { status: expectedSourceHash ? "transcript_changed" : "not_ready" };
  }

  if (expectedSourceHash && sourceHash !== expectedSourceHash) {
    return { status: "transcript_changed" };
  }

  if (JSON.stringify(source).length > FOLLOWUP_SOURCE_LIMIT) {
    return { status: "too_long" };
  }

  await assertWorkspaceHasProviderCredit(workspace);
  const result = await generateMeetingFollowup(source, meetingId);
  const current = await getComposedMeetingForFollowup(workspace, meetingId);

  if (!current?.canManage) {
    return { status: "not_found" };
  }

  if (!isFollowupReady(current) || getFollowupSourceHash(current) !== sourceHash) {
    return { status: "transcript_changed" };
  }

  const saved = await db
    .update(meetings)
    .set({ aiFollowup: { sourceHash, result } })
    .where(
      and(
        getManageableMeetingCondition(workspace, meetingId),
        eq(meetings.status, "ready"),
        eq(meetings.updatedAt, new Date(current.updatedAt)),
      ),
    )
    .returning({ id: meetings.id });

  if (!saved[0]) {
    return { status: "meeting_changed" };
  }

  return { status: "saved", result };
}

/**
 * The meeting owner's workspace, for background work that acts on the
 * owner's behalf when no one is signed in.
 */
export async function getMeetingOwnerWorkspace(
  meetingId: string,
): Promise<WorkspaceContext | null> {
  const [owner] = await db
    .select({ email: users.email, teamId: meetings.teamId, userId: users.id })
    .from(meetings)
    .innerJoin(users, eq(meetings.ownerUserId, users.id))
    .where(eq(meetings.id, meetingId))
    .limit(1);

  if (!owner) {
    return null;
  }

  return {
    domain: normalizeEmailDomain(owner.email),
    teamId: owner.teamId,
    userId: owner.userId,
  };
}

/**
 * Generates the followup as soon as a transcript is ready, so the meeting
 * page opens on its summary instead of a Generate button. Skips quietly when
 * a followup for this exact transcript is already saved.
 */
export async function autoGenerateMeetingFollowup(
  meetingId: string,
): Promise<MeetingFollowupGenerationOutcome | { status: "already_current" }> {
  const workspace = await getMeetingOwnerWorkspace(meetingId);

  if (!workspace) {
    return { status: "not_found" };
  }

  const meeting = await getComposedMeetingForFollowup(workspace, meetingId);

  if (!meeting?.canManage) {
    return { status: "not_found" };
  }

  if (!isFollowupReady(meeting)) {
    return { status: "not_ready" };
  }

  if (getCurrentMeetingFollowup(meeting)) {
    return { status: "already_current" };
  }

  return generateAndSaveMeetingFollowup({ meeting, meetingId, workspace });
}
