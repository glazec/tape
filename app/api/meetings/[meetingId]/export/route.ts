import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId } = await context.params;
  const parsedMeetingId = meetingIdSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const meetingRows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    )
    .limit(1);
  const meeting = meetingRows[0];

  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const segments = await db
    .select({
      speaker: transcriptSegments.speaker,
      startMs: transcriptSegments.startMs,
      text: transcriptSegments.text,
    })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meeting.id))
    .orderBy(asc(transcriptSegments.startMs));
  const filename = `${sanitizeFilename(meeting.title)} transcript.txt`;

  return new Response(formatTranscriptExport(meeting.title, segments), {
    headers: {
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function formatTranscriptExport(
  title: string,
  segments: Array<{ speaker: string | null; startMs: number; text: string }>,
) {
  const lines = [
    title,
    "",
    ...segments.map(
      (segment) =>
        `[${formatTimestamp(segment.startMs)}] ${segment.speaker ?? "Unknown speaker"}: ${segment.text}`,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function formatTimestamp(startMs: number) {
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function sanitizeFilename(value: string) {
  return (
    value
      .replace(/[^\w .()[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "meeting"
  );
}
