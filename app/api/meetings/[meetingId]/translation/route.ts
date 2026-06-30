import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import { currentTranscriptJobIdSubquery } from "@/lib/current-transcript-job";
import { markMeetingTranslationQueued } from "@/lib/meeting-translation-jobs";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();

export async function POST(
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
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    )
    .limit(1);

  if (!meetingRows[0]) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const segmentRows = await db
    .select({ id: transcriptSegments.id })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.meetingId, parsedMeetingId.data),
        eq(
          transcriptSegments.jobId,
          currentTranscriptJobIdSubquery(parsedMeetingId.data),
        ),
      ),
    )
    .limit(1);

  if (!segmentRows[0]) {
    return Response.json(
      { error: "Transcript is not ready yet" },
      { status: 409 },
    );
  }

  await markMeetingTranslationQueued(parsedMeetingId.data);
  await inngest.send({
    name: "meeting/enrich.transcript",
    data: { meetingId: parsedMeetingId.data, translateToChinese: true },
  });

  return Response.json({
    queued: true,
    meetingId: parsedMeetingId.data,
  });
}
