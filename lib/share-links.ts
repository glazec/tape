import { createHash } from "node:crypto";

import { and, asc, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, shareLinks, transcriptSegments } from "@/db/schema";
import type { TranscriptSegment } from "@/components/transcript-viewer";

export type SharedTranscript = {
  title: string;
  segments: TranscriptSegment[];
};

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getSharedTranscriptByToken(
  token: string,
): Promise<SharedTranscript | null> {
  const rows = await db
    .select({
      title: meetings.title,
      segmentId: transcriptSegments.id,
      speaker: transcriptSegments.speaker,
      startMs: transcriptSegments.startMs,
      text: transcriptSegments.text,
    })
    .from(shareLinks)
    .innerJoin(meetings, eq(shareLinks.meetingId, meetings.id))
    .leftJoin(transcriptSegments, eq(transcriptSegments.meetingId, meetings.id))
    .where(
      and(
        eq(shareLinks.tokenHash, hashShareToken(token)),
        gt(shareLinks.expiresAt, new Date()),
        isNull(shareLinks.revokedAt),
      ),
    )
    .orderBy(asc(transcriptSegments.startMs));

  if (rows.length === 0) {
    return null;
  }

  return {
    title: rows[0].title,
    segments: rows
      .filter((row) => row.segmentId !== null)
      .map((row) => ({
        id: row.segmentId as string,
        speaker: row.speaker,
        startMs: row.startMs as number,
        text: row.text as string,
      })),
  };
}
