import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const idSchema = z.string().uuid();
const bodySchema = z.object({
  translatedText: z.string().trim().min(1).max(5000),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ meetingId: string; segmentId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId, segmentId } = await context.params;
  const parsedMeetingId = idSchema.safeParse(meetingId);
  const parsedSegmentId = idSchema.safeParse(segmentId);

  if (!parsedMeetingId.success || !parsedSegmentId.success) {
    return Response.json({ error: "Invalid segment" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsedBody = bodySchema.safeParse(body);

  if (!parsedBody.success) {
    return Response.json({ error: "Invalid translation" }, { status: 400 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const [segment] = await db
    .select({ id: transcriptSegments.id })
    .from(transcriptSegments)
    .innerJoin(meetings, eq(transcriptSegments.meetingId, meetings.id))
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
        eq(transcriptSegments.id, parsedSegmentId.data),
      ),
    )
    .limit(1);

  if (!segment) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(transcriptSegments)
    .set({
      translatedText: parsedBody.data.translatedText,
      translationEditedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(transcriptSegments.id, parsedSegmentId.data));

  return Response.json({ translatedText: parsedBody.data.translatedText });
}
