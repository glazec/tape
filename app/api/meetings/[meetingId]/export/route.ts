import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings, transcriptSegments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { currentTranscriptJobIdSubquery } from "@/lib/current-transcript-job";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();
const transcriptFallbackWordPattern = /[A-Za-z0-9]+(?:['\u2019][A-Za-z0-9]+)?/g;
const transcriptCjkCharacterPattern = /[\u3400-\u9fff\uf900-\ufaff]/g;
const transcriptWordSegmenter = createTranscriptWordSegmenter();

export async function GET(
  request: Request,
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

  const searchParams = new URL(request.url).searchParams;
  const format = searchParams.get("format") ?? "text";

  if (format === "mp3") {
    return Response.redirect(
      new URL(
        `/api/meetings/${encodeURIComponent(parsedMeetingId.data)}/audio?download=1`,
        request.url,
      ),
    );
  }

  if (format !== "text") {
    return Response.json(
      { error: "Unsupported export format" },
      { status: 400 },
    );
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
        getReadableMeetingsCondition(workspace),
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
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
      emotionLabel: transcriptSegments.emotionLabel,
    })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.meetingId, meeting.id),
        eq(transcriptSegments.jobId, currentTranscriptJobIdSubquery(meeting.id)),
      ),
    )
    .orderBy(asc(transcriptSegments.startMs));
  const filename = getTranscriptFilename(meeting.title);

  return new Response(
    formatTranscriptExport(meeting.title, segments),
    {
      headers: {
        "content-disposition": `attachment; filename="${filename}"`,
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}

function formatTranscriptExport(
  title: string,
  segments: Array<{
    speaker: string | null;
    startMs: number;
    endMs: number | null;
    text: string;
    emotionLabel: string | null;
  }>,
) {
  const lines = [
    title,
    "Raw Transcript",
    "",
    ...segments.map(
      (segment, index) =>
        `[${formatTimestamp(segment.startMs)}] ${segment.speaker ?? "Unknown speaker"} | emotion: ${formatEmotionLabel(segment.emotionLabel)} | wpm: ${formatWordsPerMinute(segment, segments[index + 1])}: ${segment.text}`,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function formatEmotionLabel(label: string | null) {
  if (!label) {
    return "unknown";
  }

  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function formatWordsPerMinute(
  segment: {
    startMs: number;
    endMs?: number | null;
    text: string;
  },
  nextSegment?: { startMs: number },
) {
  const endMs = getEffectiveSegmentEndMs(segment, nextSegment);

  if (endMs === null) {
    return "unknown";
  }

  const durationMinutes = (endMs - segment.startMs) / 60000;
  const wordsPerMinute = countTranscriptWords(segment.text) / durationMinutes;

  return String(Math.round(wordsPerMinute));
}

function getEffectiveSegmentEndMs(
  segment: { startMs: number; endMs?: number | null },
  nextSegment?: { startMs: number },
) {
  if (typeof segment.endMs === "number" && segment.endMs > segment.startMs) {
    return segment.endMs;
  }

  return nextSegment && nextSegment.startMs > segment.startMs
    ? nextSegment.startMs
    : null;
}

function countTranscriptWords(text: string) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return 0;
  }

  if (transcriptWordSegmenter) {
    let wordCount = 0;

    for (const segment of transcriptWordSegmenter.segment(trimmedText)) {
      if (segment.isWordLike) {
        wordCount += 1;
      }
    }

    if (wordCount > 0) {
      return wordCount;
    }
  }

  const latinWordCount =
    trimmedText
      .replace(transcriptCjkCharacterPattern, " ")
      .match(transcriptFallbackWordPattern)?.length ?? 0;
  const cjkCharacterCount =
    trimmedText.match(transcriptCjkCharacterPattern)?.length ?? 0;

  return latinWordCount + cjkCharacterCount;
}

function createTranscriptWordSegmenter() {
  if (typeof Intl.Segmenter !== "function") {
    return null;
  }

  return new Intl.Segmenter(undefined, { granularity: "word" });
}

function getTranscriptFilename(title: string) {
  return `${sanitizeFilename(title)} transcript.txt`;
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
