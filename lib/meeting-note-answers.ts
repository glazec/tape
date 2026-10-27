import { createHash } from "node:crypto";
import { and, asc, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { transcriptSegments } from "@/db/schema";
import { activeTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { noteAnswerSchema, type NoteAnswer } from "@/lib/meeting-note-document";
import { generateMeetingNoteAnswer } from "@/lib/vendors/openrouter";

export type NoteTranscriptSegment = {
  id: string;
  text: string;
  startMs: number;
  speaker: string | null;
};

export function noteTranscriptRevision(segments: NoteTranscriptSegment[]) {
  return createHash("sha256").update(JSON.stringify(segments)).digest("hex");
}

export async function getNoteTranscript(meetingId: string) {
  const segments = await db
    .select({
      id: transcriptSegments.id,
      text: transcriptSegments.text,
      startMs: transcriptSegments.startMs,
      speaker: transcriptSegments.speaker,
    })
    .from(transcriptSegments)
    .where(
      and(
        sql`(${transcriptSegments.meetingId} = ${meetingId} or ${transcriptSegments.meetingId} in
          (select source_meeting_id from meeting_parts where meeting_id = ${meetingId}
            and app_private.can_read_meeting(source_meeting_id)))`,
        inArray(
          transcriptSegments.jobId,
          activeTranscriptJobIdsSubquery(transcriptSegments.meetingId),
        ),
      ),
    )
    .orderBy(
      sql`(select coalesce(started_at, created_at) from meetings where id=${transcriptSegments.meetingId})`,
      asc(transcriptSegments.startMs),
      asc(transcriptSegments.endMs),
      asc(transcriptSegments.id),
    );
  return {
    segments,
    transcriptRevision: noteTranscriptRevision(segments),
    hasTranscript: segments.some((segment) => segment.text.trim()),
  };
}

const generatedAnswerSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(1_500),
        sources: z
          .array(
            z.strictObject({
              segmentId: z.string().min(1),
              quote: z.string().trim().min(1).max(4_000),
            }),
          )
          .min(1)
          .max(2),
      }),
    )
    .max(8),
  missing: z.array(z.string().trim().min(1).max(500)).max(8),
});

export function parseNoteAnswer(
  value: string,
  question: string,
  transcript: { segments: NoteTranscriptSegment[]; transcriptRevision: string },
): NoteAnswer {
  const parsed = generatedAnswerSchema.parse(JSON.parse(value));
  const segments = new Map(
    transcript.segments.map((segment) => [segment.id, segment]),
  );
  const sources: NoteAnswer["sources"] = [];
  for (const item of parsed.items) {
    for (const source of item.sources) {
      const segment = segments.get(source.segmentId);
      if (!segment || !segment.text.includes(source.quote)) {
        throw new Error("Answer contains an unsupported transcript citation");
      }
      if (
        !sources.some(
          (existing) =>
            existing.segmentId === source.segmentId &&
            existing.quote === source.quote,
        )
      ) {
        sources.push({
          ...source,
          startMs: segment.startMs,
          speaker: segment.speaker ?? "Speaker",
        });
      }
    }
  }
  const text = [
    ...parsed.items.map((item) => `• ${item.text}`),
    ...(parsed.items.length === 0
      ? ["Not mentioned in this transcript yet."]
      : parsed.missing.map(
          (topic) => `• ${topic}: not mentioned in this transcript yet.`,
        )),
  ].join("\n");
  return noteAnswerSchema.parse({
    question,
    text,
    sources,
    transcriptRevision: transcript.transcriptRevision,
  });
}

export class NoteTranscriptTooLongError extends Error {
  constructor() {
    super(
      "This transcript is too long for automatic answers. You can still write your notes.",
    );
    this.name = "NoteTranscriptTooLongError";
  }
}

export async function answerMeetingNoteQuestion(
  meetingId: string,
  question: string,
  transcript: Awaited<ReturnType<typeof getNoteTranscript>>,
) {
  // Refuse an oversized context rather than silently omit evidence and invent absence.
  if (JSON.stringify(transcript.segments).length > 180_000) {
    throw new NoteTranscriptTooLongError();
  }
  const response = await generateMeetingNoteAnswer({
    meetingId,
    question,
    segments: transcript.segments.map(({ id, text }) => ({ id, text })),
  });
  return parseNoteAnswer(response, question, transcript);
}
