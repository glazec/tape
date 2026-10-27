import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import { upsertTeamSpeakerAliases } from "@/lib/speaker-aliases";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const speakerUpdateSchema = z
  .strictObject({
    applyTo: z
      .enum(["matching_speaker", "segment"])
      .default("matching_speaker"),
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
    participantEmail: z.email().max(254).optional(),
    rememberName: z.boolean().default(false),
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

  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meetingRows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(getManageableMeetingCondition(workspace, parsedMeetingId.data))
    .limit(1);

  if (!meetingRows[0]) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const { rememberName, participantEmail, applyTo } = result.data;
  if (rememberName) {
    if (applyTo !== "matching_speaker" || !participantEmail) {
      return Response.json({ error: "Choose a participant email to remember this name." }, { status: 400 });
    }
    const email = participantEmail.toLowerCase();
    const [identity] = await db.select({ id: meetings.id }).from(meetings).where(and(
      eq(meetings.id, meetingId),
      sql`(exists (select 1 from meeting_attendees where meeting_id=${meetingId} and lower(email)=${email})
        or exists (select 1 from meeting_participant_timeline where meeting_id=${meetingId} and lower(email)=${email})
        or exists (select 1 from calendar_events where id=${meetings.calendarEventId}
          and exists (select 1 from jsonb_array_elements_text(attendee_emails) e where lower(e)=${email}))
        or exists (select 1 from transcript_segments where meeting_id=${meetingId} and lower(btrim(speaker))=${email}))`,
    )).limit(1);
    if (!identity) return Response.json({ error: "This email is not a participant in this meeting." }, { status: 400 });
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
        inArray(
          transcriptSegments.jobId,
          currentTranscriptJobIdsSubquery(parsedMeetingId.data),
        ),
        targetFilter,
      ),
    );

  if (rememberName && participantEmail) {
    await upsertTeamSpeakerAliases({
      aliases: [participantEmail],
      canonicalName: result.data.speaker,
      teamId: workspace.teamId,
    });
  }

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
