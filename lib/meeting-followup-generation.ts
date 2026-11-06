import { acquireFollowupLease, releaseFollowupLease } from "@/lib/meeting-followup-lease";
import { getRecentMeetingCompanies } from "@/lib/recent-meeting-companies";
import { and, eq, isNull, sql } from "drizzle-orm";

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
  getCurrentMeetingConnections,
  getCurrentMeetingConnectionIds,
  getConnectionsRevision,
  storedFollowupSchema,
  getConnectionsSourceHash,
  matchesConnectionsSourceHash,
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
  | { status: "saved"; result: MeetingFollowup; connectionsRevision: string; connectionIds: string[] }
  | { status: "in_progress" }
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
async function generateLockedMeetingFollowup({
  expectedSourceHash,
  meeting,
  meetingId,
  workspace,
  leaseToken,
}: {
  /** When set, generation stops if the transcript no longer matches it. */
  expectedSourceHash?: string;
  leaseToken: string;
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

  const existing = getCurrentMeetingFollowup(meeting);
  if (existing) return { status: "saved", result: existing, connectionsRevision: getConnectionsRevision(meeting), connectionIds: getCurrentMeetingConnectionIds(meeting) };

  await assertWorkspaceHasProviderCredit(workspace);
  const recentCompanies = await getRecentMeetingCompanies(workspace.userId);
  const result = await generateMeetingFollowup(source, meetingId, recentCompanies);
  const current = await getComposedMeetingForFollowup(workspace, meetingId);

  if (!current?.canManage) {
    return { status: "not_found" };
  }

  if (!isFollowupReady(current) || getFollowupSourceHash(current) !== sourceHash) {
    return { status: "transcript_changed" };
  }

  const previous = storedFollowupSchema.safeParse(current.aiFollowup);
  const connectionEdits = previous.success && matchesConnectionsSourceHash(source, previous.data.connectionsSourceHash)
    ? previous.data.connectionEdits : undefined;
  const speakerNames = Object.fromEntries(source.segments.map(segment => [segment.id, segment.speaker]));
  const aiFollowup = { sourceHash, speakerNames, connectionsSourceHash: getConnectionsSourceHash(source), result,
    ...(connectionEdits?.length ? { connectionEdits } : {}) };
  const saved = await db
    .update(meetings)
    .set({ aiFollowup })
    .where(
      and(
        getManageableMeetingCondition(workspace, meetingId),
        eq(meetings.status, "ready"),
        eq(meetings.followupLeaseToken, leaseToken),
        eq(meetings.updatedAt, new Date(current.updatedAt)),
        getFollowupAttributionCondition(current),
        current.aiFollowup == null ? isNull(meetings.aiFollowup) : eq(meetings.aiFollowup, current.aiFollowup),
      ),
    )
    .returning({ id: meetings.id });

  if (!saved[0]) {
    return { status: "meeting_changed" };
  }

  const updated = { ...current, aiFollowup };
  return { status: "saved", result: { ...result,
    ...(result.connections ? { connections: getCurrentMeetingConnections(updated) } : {}),
  }, connectionsRevision: getConnectionsRevision(updated), connectionIds: getCurrentMeetingConnectionIds(updated) };
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

export async function generateAndSaveMeetingFollowup(input: Omit<Parameters<typeof generateLockedMeetingFollowup>[0], "leaseToken">): Promise<MeetingFollowupGenerationOutcome> {
  if (!input.meeting.canManage) return { status: "not_found" };
  const token = await acquireFollowupLease(input.meetingId);
  if (!token) return { status: "in_progress" };
  try {
    // Always generate from the owner's composition, not a viewer's aliases or
    // a subset of shared parts. Refresh after claiming to reuse a racing save.
    const workspace = await getMeetingOwnerWorkspace(input.meetingId);
    if (!workspace) return { status: "not_found" };
    const meeting = await getComposedMeetingForFollowup(workspace, input.meetingId);
    if (!meeting?.canManage) return { status: "not_found" };
    return await generateLockedMeetingFollowup({ ...input, workspace, meeting, leaseToken: token });
  } finally {
    await releaseFollowupLease(input.meetingId, token);
  }
}

// Compare all source meetings, including secondary parts, at the persistence boundary.
export function getFollowupAttributionCondition(meeting: { id?: string; attributionRevision?: number; followupSource?: { attributionRevisions?: Array<{ meetingId: string; revision: number }> } }) {
  const parts = meeting.followupSource?.attributionRevisions;
  return and(
    eq(meetings.attributionRevision, meeting.attributionRevision ?? 0),
    ...(parts ?? []).map(part => sql`exists (
      select 1 from meetings source_meeting
      where source_meeting.id = ${part.meetingId}::uuid
        and source_meeting.attribution_revision = ${part.revision}
    )`),
  );
}
