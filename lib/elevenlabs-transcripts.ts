import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, transcriptJobs, transcriptSegments } from "@/db/schema";
import type { normalizeElevenLabsWebhook } from "@/lib/vendors/elevenlabs";

type ElevenLabsTranscriptEvent = ReturnType<typeof normalizeElevenLabsWebhook>;

type TranscriptSegmentInput = {
  speaker: string | null;
  startMs: number;
  endMs: number | null;
  text: string;
};

type CompleteTranscriptPersistence = {
  action: "complete";
  meetingId: string;
  providerJobId?: string;
  segments: TranscriptSegmentInput[];
  text: string;
  transcriptJobId: string;
};

type FailTranscriptPersistence = {
  action: "fail";
  providerJobId?: string;
  transcriptJobId: string;
};

type SkipTranscriptPersistence = {
  action: "skip";
  reason:
    | "missing_transcript_job_id"
    | "missing_meeting_id"
    | "missing_transcript_text";
};

type TranscriptPersistence =
  | CompleteTranscriptPersistence
  | FailTranscriptPersistence
  | SkipTranscriptPersistence;

export function buildElevenLabsTranscriptPersistence(
  event: ElevenLabsTranscriptEvent,
): TranscriptPersistence {
  const transcriptJobId = getMetadataString(
    event.metadata,
    "transcriptJobId",
    "transcript_job_id",
  );
  const providerJobId = event.requestId ?? event.transcriptId ?? undefined;

  if (!transcriptJobId) {
    return { action: "skip", reason: "missing_transcript_job_id" };
  }

  if (isFailedStatus(event.status)) {
    return {
      action: "fail",
      providerJobId,
      transcriptJobId,
    };
  }

  const meetingId = getMetadataString(event.metadata, "meetingId", "meeting_id");

  if (!meetingId) {
    return { action: "skip", reason: "missing_meeting_id" };
  }

  const words = "transcriptionWords" in event ? event.transcriptionWords : undefined;
  const segments = buildTranscriptSegments(words);
  const text =
    event.transcriptionText?.trim() ??
    segments
      .map((segment) => segment.text)
      .join("\n")
      .trim();

  if (!text && segments.length === 0) {
    return { action: "skip", reason: "missing_transcript_text" };
  }

  return {
    action: "complete",
    meetingId,
    providerJobId,
    segments: segments.length > 0 ? segments : buildSingleSegment(text),
    text,
    transcriptJobId,
  };
}

export async function applyElevenLabsTranscriptEvent(
  event: ElevenLabsTranscriptEvent,
) {
  const persistence = buildElevenLabsTranscriptPersistence(event);

  if (persistence.action === "skip") {
    return persistence;
  }

  const now = new Date();
  const status = persistence.action === "complete" ? "completed" : "failed";
  const jobUpdate: {
    providerJobId?: string;
    status: "completed" | "failed";
    updatedAt: Date;
  } = { status, updatedAt: now };

  if (persistence.providerJobId) {
    jobUpdate.providerJobId = persistence.providerJobId;
  }

  await db
    .update(transcriptJobs)
    .set(jobUpdate)
    .where(eq(transcriptJobs.id, persistence.transcriptJobId));

  if (persistence.action === "fail") {
    return persistence;
  }

  await db
    .delete(transcriptSegments)
    .where(eq(transcriptSegments.jobId, persistence.transcriptJobId));

  await db.insert(transcriptSegments).values(
    persistence.segments.map((segment) => ({
      meetingId: persistence.meetingId,
      jobId: persistence.transcriptJobId,
      speaker: segment.speaker,
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
    })),
  );

  await db
    .update(meetings)
    .set({ status: "ready", updatedAt: now })
    .where(eq(meetings.id, persistence.meetingId));

  return persistence;
}

function getMetadataString(
  metadata: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function isFailedStatus(status: string | null) {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();

  return normalized.includes("fail") || normalized.includes("error");
}

function buildSingleSegment(text: string): TranscriptSegmentInput[] {
  return [
    {
      speaker: null,
      startMs: 0,
      endMs: null,
      text,
    },
  ];
}

type TranscriptWord = {
  text: string;
  type: string | null;
  start: number | null;
  end: number | null;
  speakerId: string | null;
};

function buildTranscriptSegments(
  words: TranscriptWord[] | undefined,
): TranscriptSegmentInput[] {
  if (!words?.length) {
    return [];
  }

  const segments: TranscriptSegmentInput[] = [];
  let current: TranscriptSegmentInput | null = null;
  let currentSpeakerId: string | null = null;

  for (const word of words) {
    if (!word.text) {
      continue;
    }

    const nextSpeakerId: string | null = word.speakerId ?? currentSpeakerId;
    const shouldStartSegment =
      !current ||
      nextSpeakerId !== currentSpeakerId ||
      shouldSplitLongSegment(current, word.text);

    if (shouldStartSegment) {
      pushSegment(segments, current);
      currentSpeakerId = nextSpeakerId;
      current = {
        speaker: formatSpeaker(nextSpeakerId),
        startMs: secondsToMs(word.start) ?? 0,
        endMs: secondsToMs(word.end),
        text: word.text,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    current.text += word.text;
    current.endMs = secondsToMs(word.end) ?? current.endMs;
  }

  pushSegment(segments, current);

  return segments;
}

function shouldSplitLongSegment(segment: TranscriptSegmentInput, text: string) {
  return segment.text.length > 700 && /[.?!]\s*$/.test(text);
}

function pushSegment(
  segments: TranscriptSegmentInput[],
  segment: TranscriptSegmentInput | null,
) {
  const text = segment?.text.replace(/\s+/g, " ").trim();

  if (!segment || !text) {
    return;
  }

  segments.push({
    ...segment,
    text,
  });
}

function formatSpeaker(speakerId: string | null) {
  if (!speakerId) {
    return null;
  }

  const numericId = speakerId.match(/\d+/)?.[0];

  if (numericId) {
    return `Speaker ${Number(numericId) + 1}`;
  }

  return speakerId
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function secondsToMs(value: number | null) {
  return typeof value === "number" ? Math.max(0, Math.round(value * 1000)) : null;
}
