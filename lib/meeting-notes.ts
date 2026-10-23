import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetingNotes, meetings } from "@/db/schema";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import type { WorkspaceContext } from "@/lib/workspace";

export async function canReadMeetingNotes(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  const rows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(eq(meetings.id, meetingId), getReadableMeetingsCondition(workspace)),
    )
    .limit(1);
  return Boolean(rows[0]);
}

export async function getMeetingNote(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  const rows = await db
    .select({ content: meetingNotes.content, version: meetingNotes.version })
    .from(meetingNotes)
    .where(
      and(
        eq(meetingNotes.meetingId, meetingId),
        eq(meetingNotes.userId, workspace.userId),
      ),
    )
    .limit(1);
  return rows[0] ?? { content: "", version: 0 };
}

export async function saveMeetingNote(
  workspace: WorkspaceContext,
  meetingId: string,
  note: { content: string; version: number },
) {
  const returning = {
    content: meetingNotes.content,
    version: meetingNotes.version,
  };
  // A version check prevents a stale tab from silently replacing newer notes.
  const rows =
    note.version === 0
      ? await db
          .insert(meetingNotes)
          .values({
            meetingId,
            userId: workspace.userId,
            content: note.content,
          })
          .onConflictDoNothing({
            target: [meetingNotes.meetingId, meetingNotes.userId],
          })
          .returning(returning)
      : await db
          .update(meetingNotes)
          .set({
            content: note.content,
            version: sql`${meetingNotes.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(meetingNotes.meetingId, meetingId),
              eq(meetingNotes.userId, workspace.userId),
              eq(meetingNotes.version, note.version),
            ),
          )
          .returning(returning);
  return rows[0] ?? null;
}
