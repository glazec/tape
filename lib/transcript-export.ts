import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { transcriptSegments } from "@/db/schema";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { attachSpeakerIdentities } from "@/lib/speaker-identity";
import type { WorkspaceContext } from "@/lib/workspace";

const transcriptFallbackWordPattern = /[A-Za-z0-9]+(?:['\u2019][A-Za-z0-9]+)?/g;
const transcriptCjkCharacterPattern = /[\u3400-\u9fff\uf900-\ufaff]/g;
const transcriptWordSegmenter = createTranscriptWordSegmenter();

export async function exportTranscriptSection(workspace: WorkspaceContext, meetingId: string, title: string) {
  const segments = await db
    .select({
      id: transcriptSegments.id,
      meetingSpeakerId: transcriptSegments.meetingSpeakerId,
      speaker: transcriptSegments.speaker,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
      emotionLabel: transcriptSegments.emotionLabel,
    })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.meetingId, meetingId),
        inArray(
          transcriptSegments.jobId,
          currentTranscriptJobIdsSubquery(meetingId),
        ),
      ),
    )
    .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.id));
  const displaySegments = await attachSpeakerIdentities(meetingId, segments, { workspace });
  const section = formatTranscriptExport(title, displaySegments);
  return segments.length ? section : section + "\nTranscript not available yet.\n";
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

function formatTimestamp(startMs: number) {
  const totalSeconds = Math.floor(startMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function sanitizeFilename(value: string) {
  return (
    value
      .replace(/[^\w .()[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "meeting"
  );
}
