import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const speakerUpdateSchema = z
  .object({
    applyTo: z.enum(["matching_speaker", "segment"]).default("matching_speaker"),
    currentSpeaker: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().min(1).nullable(),
    ),
    segmentId: z.string().uuid().optional(),
    speaker: z.string().trim().min(1).max(80),
  })
  .strict()
  .refine(
    (value) => value.applyTo === "matching_speaker" || Boolean(value.segmentId),
    {
      message: "Segment is required",
      path: ["segmentId"],
    },
  );

const meetingIdSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const result = speakerUpdateSchema.safeParse(body);

  if (!result.success) {
    return Response.json({ error: "Invalid speaker label" }, { status: 400 });
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

  const targetFilter =
    result.data.applyTo === "segment"
      ? eq(transcriptSegments.id, result.data.segmentId!)
      : result.data.currentSpeaker
        ? eq(transcriptSegments.speaker, result.data.currentSpeaker)
        : isNull(transcriptSegments.speaker);

  await db
    .update(transcriptSegments)
    .set({
      speaker: result.data.speaker,
      updatedAt: new Date(),
    })
    .where(
      and(eq(transcriptSegments.meetingId, parsedMeetingId.data), targetFilter),
    );

  return Response.json({
    applyTo: result.data.applyTo,
    segmentId: result.data.segmentId ?? null,
    updated: true,
    speaker: result.data.speaker,
  });
}
