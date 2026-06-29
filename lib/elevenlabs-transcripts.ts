import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  calendarEvents,
  meetingEntities,
  meetings,
  transcriptJobs,
  transcriptSegments,
  users,
} from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import {
  listMeetingParticipantTimeline,
  type ParticipantTimelineEntry,
} from "@/lib/meeting-participant-timeline";
import {
  classifySegmentEmotion,
  extractMeetingEntities,
  type ExtractedMeetingEntity,
  type SegmentEmotion,
  type TranscriptDetectedEntity,
} from "@/lib/meeting-intelligence";
import type { normalizeElevenLabsWebhook } from "@/lib/vendors/elevenlabs";

type ElevenLabsTranscriptEvent = ReturnType<typeof normalizeElevenLabsWebhook>;

type TranscriptSegmentInput = {
  emotionLabel?: SegmentEmotion["label"];
  emotionReason?: string;
  speaker: string | null;
  startMs: number;
  endMs: number | null;
  text: string;
};

type CompleteTranscriptPersistence = {
  action: "complete";
  meetingId: string;
  providerJobId?: string;
  entities: ExtractedMeetingEntity[];
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

type EntityExtractionContext = {
  attendeeEmails?: string[];
  meetingUrl?: string | null;
  workspaceDomain?: string | null;
};

export function buildElevenLabsTranscriptPersistence(
  event: ElevenLabsTranscriptEvent,
  options: {
    entityContext?: EntityExtractionContext;
    participantTimeline?: ParticipantTimelineEntry[];
  } = {},
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
  const segments = buildTranscriptSegments(words, options.participantTimeline ?? []);
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
    entities: extractEntitiesFromSegments(
      segments.length > 0 ? segments : buildSingleSegment(text),
      buildEntityExtractionContext(event, options.entityContext),
    ),
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
  const meetingId = getMetadataString(event.metadata, "meetingId", "meeting_id");
  const participantTimeline = meetingId
    ? await listMeetingParticipantTimeline(meetingId)
    : [];
  const entityContext = meetingId
    ? await loadMeetingEntityContext(meetingId)
    : {};
  const persistence = buildElevenLabsTranscriptPersistence(event, {
    entityContext,
    participantTimeline,
  });

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
    .delete(meetingEntities)
    .where(eq(meetingEntities.meetingId, persistence.meetingId));

  await db
    .delete(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, persistence.meetingId));

  const insertedSegments = await db
    .insert(transcriptSegments)
    .values(
      persistence.segments.map((segment) => ({
        meetingId: persistence.meetingId,
        jobId: persistence.transcriptJobId,
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        emotionLabel: segment.emotionLabel,
        emotionReason: segment.emotionReason,
      })),
    )
    .returning({ id: transcriptSegments.id });
  const segmentIdByReference = new Map(
    insertedSegments.map((segment, index) => [`segment_${index}`, segment.id]),
  );

  if (persistence.entities.length > 0) {
    await db
      .insert(meetingEntities)
      .values(
        persistence.entities.map((entity) => ({
          meetingId: persistence.meetingId,
          aliases: entity.aliases,
          segmentId: entity.segmentId
            ? (segmentIdByReference.get(entity.segmentId) ?? null)
            : null,
          source: entity.source,
          type: entity.type,
          value: entity.value,
          normalizedValue: entity.normalizedValue,
        })),
      )
      .onConflictDoNothing({
        target: [
          meetingEntities.meetingId,
          meetingEntities.type,
          meetingEntities.normalizedValue,
        ],
      });
  }

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

function getMetadataList(
  metadata: Record<string, unknown>,
  ...keys: string[]
) {
  const value = getMetadataString(metadata, ...keys);

  if (!value) {
    return [];
  }

  return value
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadMeetingEntityContext(
  meetingId: string,
): Promise<EntityExtractionContext> {
  const [row] = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      calendarMeetingUrl: calendarEvents.meetingUrl,
      meetingUrl: meetings.meetingUrl,
      ownerEmail: users.email,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .leftJoin(users, eq(users.id, meetings.ownerUserId))
    .where(eq(meetings.id, meetingId))
    .limit(1);

  return {
    attendeeEmails: normalizeAttendeeEmails(row?.attendeeEmails),
    meetingUrl: row?.meetingUrl ?? row?.calendarMeetingUrl ?? null,
    workspaceDomain: row?.ownerEmail
      ? normalizeEmailDomain(row.ownerEmail)
      : null,
  };
}

function normalizeAttendeeEmails(attendeeEmails: unknown) {
  if (!Array.isArray(attendeeEmails)) {
    return [];
  }

  return attendeeEmails
    .filter((email): email is string => typeof email === "string")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isFailedStatus(status: string | null) {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();

  return normalized.includes("fail") || normalized.includes("error");
}

function buildSingleSegment(text: string): TranscriptSegmentInput[] {
  const emotion = classifySegmentEmotion({
    text,
    startMs: 0,
    endMs: null,
  });

  return [
    {
      emotionLabel: emotion.label,
      emotionReason: emotion.reason,
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
  participantTimeline: ParticipantTimelineEntry[],
): TranscriptSegmentInput[] {
  if (!words?.length) {
    return [];
  }

  const segments: TranscriptSegmentInput[] = [];
  let current: TranscriptSegmentInput | null = null;
  let currentSpeakerId: string | null = null;
  let currentSpeakerLabel: string | null = null;

  for (const word of words) {
    if (!word.text) {
      continue;
    }

    const nextSpeakerId: string | null = word.speakerId ?? currentSpeakerId;
    const nextSpeakerLabel = formatSpeaker(
      nextSpeakerId,
      secondsToMs(word.start),
      secondsToMs(word.end),
      participantTimeline,
    );
    const shouldStartSegment =
      !current ||
      nextSpeakerId !== currentSpeakerId ||
      nextSpeakerLabel !== currentSpeakerLabel ||
      shouldSplitLongSegment(current, word.text);

    if (shouldStartSegment) {
      pushSegment(segments, current);
      currentSpeakerId = nextSpeakerId;
      currentSpeakerLabel = nextSpeakerLabel;
      current = {
        speaker: nextSpeakerLabel,
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

  const emotion = classifySegmentEmotion({
    text,
    startMs: segment.startMs,
    endMs: segment.endMs,
  });

  segments.push({
    ...segment,
    emotionLabel: emotion.label,
    emotionReason: emotion.reason,
    text,
  });
}

function buildEntityExtractionContext(
  event: ElevenLabsTranscriptEvent,
  context: EntityExtractionContext = {},
) {
  const attendeeEmails = getMetadataList(
    event.metadata,
    "attendeeEmails",
    "attendee_emails",
  );

  return {
    attendeeEmails:
      attendeeEmails.length > 0 ? attendeeEmails : context.attendeeEmails ?? [],
    meetingUrl:
      getMetadataString(event.metadata, "meetingUrl", "meeting_url") ??
      context.meetingUrl ??
      null,
    transcriptEntities:
      "transcriptionEntities" in event
        ? (event.transcriptionEntities as TranscriptDetectedEntity[] | undefined)
        : undefined,
    workspaceDomain:
      getMetadataString(
        event.metadata,
        "workspaceDomain",
        "workspace_domain",
      ) ??
      context.workspaceDomain ??
      null,
  };
}

function extractEntitiesFromSegments(
  segments: TranscriptSegmentInput[],
  context: ReturnType<typeof buildEntityExtractionContext>,
) {
  return extractMeetingEntities(
    segments.map((segment, index) => ({
      id: `segment_${index}`,
      text: segment.text,
    })),
    context,
  );
}

function formatSpeaker(
  speakerId: string | null,
  startMs: number | null,
  endMs: number | null,
  participantTimeline: ParticipantTimelineEntry[],
) {
  if (!speakerId) {
    return null;
  }

  const fallback = formatFallbackSpeaker(speakerId);
  const participant = findDominantParticipant({
    endMs,
    participantTimeline,
    startMs,
  });

  if (participant?.name) {
    return isSharedMicrophoneName(participant.name)
      ? `${participant.name} · ${fallback}`
      : participant.name;
  }

  return fallback;
}

function formatFallbackSpeaker(speakerId: string) {
  const numericId = speakerId.match(/\d+/)?.[0];

  if (numericId) {
    return `Speaker ${Number(numericId) + 1}`;
  }

  return speakerId
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findDominantParticipant(input: {
  startMs: number | null;
  endMs: number | null;
  participantTimeline: ParticipantTimelineEntry[];
}) {
  if (input.startMs === null || input.participantTimeline.length === 0) {
    return null;
  }

  const startMs = input.startMs;
  const endMs = input.endMs && input.endMs > startMs ? input.endMs : startMs + 1;
  let best:
    | {
        entry: ParticipantTimelineEntry;
        overlapMs: number;
      }
    | null = null;

  for (const entry of input.participantTimeline) {
    const entryEndMs = entry.endMs ?? endMs;
    const overlapMs = Math.max(
      0,
      Math.min(endMs, entryEndMs) - Math.max(startMs, entry.startMs),
    );

    if (!best || overlapMs > best.overlapMs) {
      best = { entry, overlapMs };
    }
  }

  return best && best.overlapMs > 0 ? best.entry : null;
}

function isSharedMicrophoneName(name: string) {
  return /\b(room|conference|speakerphone|shared)\b/i.test(name);
}

function secondsToMs(value: number | null) {
  return typeof value === "number" ? Math.max(0, Math.round(value * 1000)) : null;
}
