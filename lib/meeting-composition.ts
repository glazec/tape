import { and, asc, desc, eq, ilike, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { meetingParts, meetings } from "@/db/schema";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import {
  getManageableMeetingCondition,
  getMeetingManagerCondition,
} from "@/lib/meeting-write-policy";
import type { WorkspaceContext } from "@/lib/workspace";

import { MeetingCompositionError } from "@/lib/meeting-composition-error";
export { MeetingCompositionError } from "@/lib/meeting-composition-error";

export async function requireManageableComposition(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(getManageableMeetingCondition(workspace, meetingId))
    .limit(1);
  if (!meeting) throw new MeetingCompositionError("Meeting not found", 404);
  const [parent] = await db
    .select({ id: meetingParts.meetingId })
    .from(meetingParts)
    .where(eq(meetingParts.sourceMeetingId, meetingId))
    .limit(1);
  if (parent)
    throw new MeetingCompositionError(
      "Open the combined meeting to add another recording.",
    );
  return meeting;
}

// Every read rechecks source access. Sharing the destination never grants access
// to a source, even if the two audiences change after they have been merged.
export async function listReadableMeetingSources(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  return db
    .select({
      id: meetings.id,
      title: meetings.title,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
      status: meetings.status,
      kind: meetingParts.kind,
      linkedAt: meetingParts.createdAt,
    })
    .from(meetingParts)
    .innerJoin(meetings, eq(meetings.id, meetingParts.sourceMeetingId))
    .where(
      and(
        eq(meetingParts.meetingId, meetingId),
        getReadableMeetingsCondition(workspace),
      ),
    )
    .orderBy(asc(meetings.startedAt), asc(meetings.createdAt), asc(meetings.id))
    .limit(20);
}

export async function listMergeCandidates(
  workspace: WorkspaceContext,
  meetingId: string,
  query = "",
) {
  const target = await requireManageableComposition(workspace, meetingId);
  const candidates = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startedAt: meetings.startedAt,
      status: meetings.status,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, target.teamId),
        eq(meetings.ownerUserId, target.ownerUserId),
        eq(
          meetings.organizationAccessEnabled,
          target.organizationAccessEnabled,
        ),
        ne(meetings.id, meetingId),
        getMeetingManagerCondition(workspace),
        query
          ? ilike(meetings.title, `%${query.replace(/[\\%_]/g, "\\$&")}%`)
          : undefined,
        sql`not exists (select 1 from meeting_parts p where p.source_meeting_id = ${meetings.id} or p.meeting_id = ${meetings.id})`,
        sql`not exists (
        (select user_id, role from meeting_access where meeting_id = ${meetingId} and revoked_at is null
         except select user_id, role from meeting_access where meeting_id = ${meetings.id} and revoked_at is null)
        union all
        (select user_id, role from meeting_access where meeting_id = ${meetings.id} and revoked_at is null
         except select user_id, role from meeting_access where meeting_id = ${meetingId} and revoked_at is null)
      )`,
      ),
    )
    .orderBy(
      desc(meetings.startedAt),
      desc(meetings.createdAt),
      asc(meetings.id),
    )
    .limit(30);
  const sources = await listReadableMeetingSources(workspace, meetingId);
  return {
    candidates,
    merged: sources.filter((source) => source.kind === "merge"),
  };
}

export async function mergeMeetings(
  workspace: WorkspaceContext,
  meetingId: string,
  sourceMeetingId: string,
) {
  const target = await requireManageableComposition(workspace, meetingId);
  const [source] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        getManageableMeetingCondition(workspace, sourceMeetingId),
        eq(meetings.teamId, target.teamId),
      ),
    )
    .limit(1);
  if (!source || meetingId === sourceMeetingId)
    throw new MeetingCompositionError("Meeting unavailable", 404);
  const [existing] = await db
    .select()
    .from(meetingParts)
    .where(eq(meetingParts.sourceMeetingId, sourceMeetingId))
    .limit(1);
  if (existing?.meetingId === meetingId) return;
  if (existing)
    throw new MeetingCompositionError(
      "This meeting is already part of another meeting.",
    );
  try {
    await db
      .insert(meetingParts)
      .values({ meetingId, sourceMeetingId, kind: "merge" });
  } catch (error) {
    if (isCompositionConflict(error))
      throw new MeetingCompositionError(
        "These meetings cannot be merged. Check their sharing and refresh.",
      );
    throw error;
  }
}

export async function unmergeMeeting(
  workspace: WorkspaceContext,
  meetingId: string,
  sourceMeetingId: string,
) {
  await requireManageableComposition(workspace, meetingId);
  await db
    .delete(meetingParts)
    .where(
      and(
        eq(meetingParts.meetingId, meetingId),
        eq(meetingParts.sourceMeetingId, sourceMeetingId),
        eq(meetingParts.kind, "merge"),
      ),
    );
}

export function isCompositionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; cause?: unknown };
  return (
    ["23505", "23514"].includes(candidate.code ?? "") ||
    isCompositionConflict(candidate.cause)
  );
}

export async function getMeetingCompositionForWorkspace(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  // Lazy import avoids coupling ordinary transcript reads to composition queries.
  const { getMeetingTranscriptForWorkspace } =
    await import("@/lib/meeting-queries");
  const primary = await getMeetingTranscriptForWorkspace(workspace, meetingId);
  if (!primary) return null;
  const sources = await listReadableMeetingSources(workspace, meetingId);
  const [parent] = await db
    .select({ id: meetings.id, title: meetings.title })
    .from(meetingParts)
    .innerJoin(meetings, eq(meetings.id, meetingParts.meetingId))
    .where(
      and(
        eq(meetingParts.sourceMeetingId, meetingId),
        getReadableMeetingsCondition(workspace),
      ),
    )
    .limit(1);
  const parts = await Promise.all(
    sources.map((source) =>
      getMeetingTranscriptForWorkspace(workspace, source.id),
    ),
  );
  return {
    primary,
    sources,
    parent: parent ?? null,
    parts: [primary, ...parts.filter((part) => part !== null)].sort(
      (a, b) =>
        Date.parse(a.startedAt ?? "1970-01-01") -
          Date.parse(b.startedAt ?? "1970-01-01") || a.id.localeCompare(b.id),
    ),
  };
}

// Followups cover every readable part and are invalidated when any source changes.
export function composeMeetingForFollowup(
  composition: NonNullable<
    Awaited<ReturnType<typeof getMeetingCompositionForWorkspace>>
  >,
) {
  const { primary, parts } = composition;
  if (parts.length === 1) return primary;
  const complete = parts.every(
    (part) =>
      part.status === "ready" &&
      (!part.transcriptJobStatus || part.transcriptJobStatus === "completed"),
  );
  return {
    ...primary,
    status: complete ? ("ready" as const) : ("processing" as const),
    transcriptJobStatus: complete
      ? ("completed" as const)
      : ("queued" as const),
    segments: parts.flatMap((part) => part.segments),
    followupSource: {
      title: primary.title,
      startedAt: parts[0].startedAt,
      segments: parts.flatMap(
        (part) => part.followupSource?.segments ?? part.segments,
      ),
    },
  };
}

export async function getComposedMeetingForFollowup(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  const composition = await getMeetingCompositionForWorkspace(
    workspace,
    meetingId,
  );
  return composition ? composeMeetingForFollowup(composition) : null;
}
