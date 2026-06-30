import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { currentTranscriptJobIdSubquery } from "@/lib/current-transcript-job";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const speakerUpdateSchema = z
  .strictObject({
    applyTo: z.enum(["matching_speaker", "segment"]).default("matching_speaker"),
    currentSpeaker: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().min(1).nullable(),
    ),
    currentSpeakerAliases: z
      .array(z.string().trim().min(1).max(80))
      .max(20)
      .default([]),
    segmentId: z.uuid().optional(),
    speaker: z.string().trim().min(1).max(80),
  })
  .refine(
    (value) => value.applyTo === "matching_speaker" || Boolean(value.segmentId),
    {
      message: "Segment is required",
      path: ["segmentId"],
    },
  );

const meetingIdSchema = z.uuid();

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

  const targetFilter = getSpeakerUpdateFilter(result.data);

  await db
    .update(transcriptSegments)
    .set({
      speaker: result.data.speaker,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(transcriptSegments.meetingId, parsedMeetingId.data),
        eq(
          transcriptSegments.jobId,
          currentTranscriptJobIdSubquery(parsedMeetingId.data),
        ),
        targetFilter,
      ),
    );

  return Response.json({
    applyTo: result.data.applyTo,
    segmentId: result.data.segmentId ?? null,
    updated: true,
    speaker: result.data.speaker,
  });
}

function getSpeakerUpdateFilter(input: z.infer<typeof speakerUpdateSchema>) {
  const normalizedSpeaker = input.speaker.trim().toLowerCase();
  const matchingTargetSpeaker = sql`${transcriptSegments.speaker} is not null and lower(btrim(${transcriptSegments.speaker})) = ${normalizedSpeaker}`;

  if (input.applyTo === "segment") {
    return eq(transcriptSegments.id, input.segmentId!);
  }

  const filters: SQL[] = [
    input.currentSpeaker
      ? eq(transcriptSegments.speaker, input.currentSpeaker)
      : isNull(transcriptSegments.speaker),
    matchingTargetSpeaker,
  ];
  const aliases = Array.from(new Set(input.currentSpeakerAliases));

  if (aliases.length > 0) {
    filters.push(inArray(transcriptSegments.speaker, aliases));
  }

  return combineFilters(filters);
}

function combineFilters(filters: SQL[]) {
  const [first, ...rest] = filters;

  return rest.length > 0 ? or(first, ...rest)! : first;
}
