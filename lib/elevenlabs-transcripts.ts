import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  calendarEvents,
  localRecordings,
  meetingEntities,
  meetings,
  recordings,
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
import { getPreferredParticipantSpeakerName } from "@/lib/speaker-labels";
import {
  getTwentyCrmCompanyDomains,
  type TwentyCrmCompanyDomain,
} from "@/lib/vendors/twenty";
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
  recordingId?: string;
  providerJobId?: string;
  entities: ExtractedMeetingEntity[];
  segments: TranscriptSegmentInput[];
  text: string;
  transcriptJobId: string;
};

type FailTranscriptPersistence = {
  action: "fail";
  errorMessage?: string;
  providerJobId?: string;
  transcriptJobId: string;
};

type SkipTranscriptPersistence = {
  action: "skip";
  reason:
    | "missing_transcript_job_id"
    | "missing_meeting_id"
    | "missing_transcript_text"
    | "superseded_transcript_job";
};

type TranscriptPersistence =
  | CompleteTranscriptPersistence
  | FailTranscriptPersistence
  | SkipTranscriptPersistence;

type EntityExtractionContext = {
  attendeeEmails?: string[];
  meetingUrl?: string | null;
  organizationDomains?: TwentyCrmCompanyDomain[];
  workspaceDomain?: string | null;
};

type LocalRecorderActivityWindow = {
  startsAt: number;
  endsAt: number;
  microphoneActive: boolean;
  computerAudioActive: boolean;
};

type LocalRecorderAttributionContext = {
  localUserSpeaker: string;
  activityWindows: LocalRecorderActivityWindow[];
};

type LocalRecorderSpeakerAttribution =
  | "local_user"
  | "remote_speaker"
  | "overlap"
  | "silence"
  | "unknown";

type LocalRecorderSpeakerLabelContext = {
  labelRemoteSpeakerByActivity: boolean;
  labelsBySpeakerId: Map<string, string>;
};

export function buildElevenLabsTranscriptPersistence(
  event: ElevenLabsTranscriptEvent,
  options: {
    entityContext?: EntityExtractionContext;
    localRecorderAttribution?: LocalRecorderAttributionContext | null;
    participantTimeline?: ParticipantTimelineEntry[];
  } = {},
): TranscriptPersistence {
  const transcriptJobId = getMetadataString(
    event.metadata,
    "transcriptJobId",
    "transcript_job_id",
  );
  const providerJobId = event.requestId ?? event.transcriptId ?? undefined;
  const recordingId = getMetadataString(
    event.metadata,
    "recordingId",
    "recording_id",
  ) ?? undefined;

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

  const words = "transcriptionWords" in event ? event.transcriptionWords : undefined;
  const segments = buildTranscriptSegments(
    words,
    options.participantTimeline ?? [],
    options.localRecorderAttribution ?? null,
  );
  const text =
    event.transcriptionText?.trim() ??
    segments
      .map((segment) => segment.text)
      .join("\n")
      .trim();

  if (!text && segments.length === 0) {
    return {
      action: "fail",
      errorMessage: "No transcript text returned",
      providerJobId,
      transcriptJobId,
    };
  }

  const meetingId = getMetadataString(event.metadata, "meetingId", "meeting_id");

  if (!meetingId) {
    return { action: "skip", reason: "missing_meeting_id" };
  }

  return {
    action: "complete",
    entities: extractEntitiesFromSegments(
      segments.length > 0 ? segments : buildSingleSegment(text),
      buildEntityExtractionContext(event, options.entityContext),
    ),
    meetingId,
    ...(recordingId ? { recordingId } : {}),
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
  const transcriptJobId = getMetadataString(
    event.metadata,
    "transcriptJobId",
    "transcript_job_id",
  );

  if (
    meetingId &&
    transcriptJobId &&
    !(await isLatestTranscriptJob(meetingId, transcriptJobId))
  ) {
    return { action: "skip", reason: "superseded_transcript_job" } as const;
  }

  let participantTimeline: ParticipantTimelineEntry[] = [];
  let entityContext: EntityExtractionContext = {};
  let localRecorderAttribution: LocalRecorderAttributionContext | null = null;

  if (meetingId) {
    [participantTimeline, entityContext, localRecorderAttribution] =
      await Promise.all([
        listMeetingParticipantTimeline(meetingId),
        loadMeetingEntityContext(meetingId),
        loadLocalRecorderAttributionContext(transcriptJobId),
      ]);
  }

  const persistence = buildElevenLabsTranscriptPersistence(event, {
    entityContext,
    localRecorderAttribution,
    participantTimeline,
  });

  if (persistence.action === "skip") {
    return persistence;
  }

  const now = new Date();
  const status = persistence.action === "complete" ? "completed" : "failed";
  const jobUpdate: {
    errorMessage?: string;
    providerJobId?: string;
    status: "completed" | "failed";
    updatedAt: Date;
  } = { status, updatedAt: now };

  if (persistence.providerJobId) {
    jobUpdate.providerJobId = persistence.providerJobId;
  }

  if (persistence.action === "fail" && persistence.errorMessage) {
    jobUpdate.errorMessage = persistence.errorMessage;
  }

  await db
    .update(transcriptJobs)
    .set(jobUpdate)
    .where(eq(transcriptJobs.id, persistence.transcriptJobId));

  if (persistence.action === "fail") {
    if (meetingId) {
      await db
        .update(meetings)
        .set({ status: "failed", updatedAt: now })
        .where(eq(meetings.id, meetingId));
    }

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

  const transcriptDurationMs = persistence.segments.reduce(
    (maximum, segment) =>
      Math.max(maximum, segment.endMs ?? segment.startMs),
    0,
  );

  if (persistence.recordingId && transcriptDurationMs > 0) {
    await db
      .update(recordings)
      .set({ durationMs: transcriptDurationMs, updatedAt: now })
      .where(
        and(
          eq(recordings.id, persistence.recordingId),
          isNull(recordings.durationMs),
        ),
      );
  }

  await db
    .update(meetings)
    .set({ status: "ready", updatedAt: now })
    .where(eq(meetings.id, persistence.meetingId));

  return persistence;
}

async function isLatestTranscriptJob(meetingId: string, transcriptJobId: string) {
  const result = await db.execute<{ id: string }>(sql`
    select id
    from transcript_jobs
    where meeting_id = ${meetingId}::uuid
    order by created_at desc, id desc
    limit 1
  `);

  return result.rows[0]?.id === transcriptJobId;
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
  const [rows, organizationDomains] = await Promise.all([
    db
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
      .limit(1),
    getTwentyCrmCompanyDomains(),
  ]);
  const row = rows[0];

  return {
    attendeeEmails: normalizeAttendeeEmails(row?.attendeeEmails),
    meetingUrl: row?.meetingUrl ?? row?.calendarMeetingUrl ?? null,
    organizationDomains,
    workspaceDomain: row?.ownerEmail
      ? normalizeEmailDomain(row.ownerEmail)
      : null,
  };
}

async function loadLocalRecorderAttributionContext(
  transcriptJobId: string | null,
): Promise<LocalRecorderAttributionContext | null> {
  if (!transcriptJobId) {
    return null;
  }

  let recording:
    | {
        manifest: unknown;
        ownerEmail: string | null;
        ownerName: string | null;
      }
    | undefined;

  try {
    [recording] = await db
      .select({
        manifest: localRecordings.manifest,
        ownerEmail: users.email,
        ownerName: users.name,
      })
      .from(transcriptJobs)
      .innerJoin(
        localRecordings,
        eq(localRecordings.synthesizedAudioAssetId, transcriptJobs.mediaAssetId),
      )
      .innerJoin(users, eq(users.id, localRecordings.ownerUserId))
      .where(eq(transcriptJobs.id, transcriptJobId))
      .limit(1);
  } catch {
    return null;
  }

  const activityWindows = parseLocalRecorderActivityWindows(recording?.manifest);

  if (!recording || activityWindows.length === 0) {
    return null;
  }

  return {
    activityWindows,
    localUserSpeaker:
      getPreferredParticipantSpeakerName({
        email: recording.ownerEmail,
        name: recording.ownerName,
      }) ?? "Local user",
  };
}

function parseLocalRecorderActivityWindows(
  manifest: unknown,
): LocalRecorderActivityWindow[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.activityWindows)) {
    return [];
  }

  return manifest.activityWindows.flatMap((value) => {
    if (!isRecord(value)) {
      return [];
    }

    const startsAt = getFiniteNumber(value.startsAt);
    const endsAt = getFiniteNumber(value.endsAt);

    if (startsAt === null || endsAt === null || endsAt <= startsAt) {
      return [];
    }

    return [
      {
        startsAt,
        endsAt,
        microphoneActive: value.microphoneActive === true,
        computerAudioActive: value.computerAudioActive === true,
      },
    ];
  });
}

function getFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  localRecorderAttribution: LocalRecorderAttributionContext | null,
): TranscriptSegmentInput[] {
  if (!words?.length) {
    return [];
  }

  const segments: TranscriptSegmentInput[] = [];
  const localRecorderSpeakerLabels = buildLocalRecorderSpeakerLabelContext(
    words,
    localRecorderAttribution,
  );
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
      localRecorderAttribution,
      localRecorderSpeakerLabels,
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
    organizationDomains: context.organizationDomains ?? [],
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

function formatLocalRecorderSpeaker(input: {
  startMs: number | null;
  endMs: number | null;
  localRecorderAttribution: LocalRecorderAttributionContext | null;
  labelRemoteSpeakerByActivity: boolean;
}) {
  const attribution = classifyLocalRecorderSegmentTime(input);

  if (attribution === "remote_speaker" && input.labelRemoteSpeakerByActivity) {
    return "PC sound";
  }

  if (attribution !== "local_user" || !input.localRecorderAttribution) {
    return null;
  }

  return input.localRecorderAttribution.localUserSpeaker;
}

function classifyLocalRecorderSegment(input: {
  activityWindows: LocalRecorderActivityWindow[];
  startSeconds: number;
  endSeconds: number;
}): LocalRecorderSpeakerAttribution {
  const segmentDuration = input.endSeconds - input.startSeconds;

  if (segmentDuration <= 0) {
    return "unknown";
  }

  let localUserDuration = 0;
  let remoteSpeakerDuration = 0;
  let overlapDuration = 0;
  let silenceDuration = 0;
  let coveredDuration = 0;

  for (const window of input.activityWindows) {
    const startsAt = Math.max(input.startSeconds, window.startsAt);
    const endsAt = Math.min(input.endSeconds, window.endsAt);
    const overlap = endsAt - startsAt;

    if (overlap <= 0) {
      continue;
    }

    coveredDuration += overlap;

    if (window.microphoneActive && !window.computerAudioActive) {
      localUserDuration += overlap;
    } else if (!window.microphoneActive && window.computerAudioActive) {
      remoteSpeakerDuration += overlap;
    } else if (window.microphoneActive && window.computerAudioActive) {
      overlapDuration += overlap;
    } else {
      silenceDuration += overlap;
    }
  }

  if (coveredDuration / segmentDuration < 0.2) {
    return "unknown";
  }

  const candidates = [
    { duration: localUserDuration, attribution: "local_user" },
    { duration: remoteSpeakerDuration, attribution: "remote_speaker" },
    { duration: overlapDuration, attribution: "overlap" },
    { duration: silenceDuration, attribution: "silence" },
  ] as const;
  const winner = candidates.reduce((best, candidate) =>
    candidate.duration > best.duration ? candidate : best,
  );

  return winner.duration > 0 ? winner.attribution : "unknown";
}

function classifyLocalRecorderSegmentTime(input: {
  startMs: number | null;
  endMs: number | null;
  localRecorderAttribution: LocalRecorderAttributionContext | null;
}): LocalRecorderSpeakerAttribution {
  if (!input.localRecorderAttribution || input.startMs === null) {
    return "unknown";
  }

  const startSeconds = input.startMs / 1000;
  const endSeconds =
    input.endMs !== null && input.endMs > input.startMs
      ? input.endMs / 1000
      : startSeconds + 0.001;

  return classifyLocalRecorderSegment({
    activityWindows: input.localRecorderAttribution.activityWindows,
    endSeconds,
    startSeconds,
  });
}

function buildLocalRecorderSpeakerLabelContext(
  words: TranscriptWord[],
  localRecorderAttribution: LocalRecorderAttributionContext | null,
): LocalRecorderSpeakerLabelContext {
  const context: LocalRecorderSpeakerLabelContext = {
    labelRemoteSpeakerByActivity: false,
    labelsBySpeakerId: new Map(),
  };

  if (!localRecorderAttribution) {
    return context;
  }

  const speakerIds = new Set<string>();
  const localSpeakerIds = new Set<string>();

  for (const word of words) {
    if (!word.speakerId) {
      continue;
    }

    speakerIds.add(word.speakerId);

    const attribution = classifyLocalRecorderSegmentTime({
      endMs: secondsToMs(word.end),
      localRecorderAttribution,
      startMs: secondsToMs(word.start),
    });

    if (attribution === "local_user") {
      localSpeakerIds.add(word.speakerId);
    }
  }

  if (localSpeakerIds.size !== 1) {
    return context;
  }

  if (speakerIds.size === 1) {
    context.labelRemoteSpeakerByActivity = true;
    return context;
  }

  const localSpeakerId = Array.from(localSpeakerIds)[0];

  if (!localSpeakerId) {
    return context;
  }

  context.labelsBySpeakerId.set(
    localSpeakerId,
    localRecorderAttribution.localUserSpeaker,
  );

  // Everyone other than the local mic comes off the shared computer-audio
  // track. With a single remote cluster, "PC sound" reads cleanly; with
  // several, number them so distinct remote participants stay attributable
  // instead of collapsing into one identity.
  const remoteSpeakerIds = Array.from(speakerIds)
    .filter((speakerId) => speakerId !== localSpeakerId)
    .sort();

  if (remoteSpeakerIds.length === 1) {
    context.labelsBySpeakerId.set(remoteSpeakerIds[0], "PC sound");
  } else {
    remoteSpeakerIds.forEach((speakerId, index) => {
      context.labelsBySpeakerId.set(speakerId, `PC sound ${index + 1}`);
    });
  }

  return context;
}

function formatSpeaker(
  speakerId: string | null,
  startMs: number | null,
  endMs: number | null,
  participantTimeline: ParticipantTimelineEntry[],
  localRecorderAttribution: LocalRecorderAttributionContext | null,
  localRecorderSpeakerLabels: LocalRecorderSpeakerLabelContext,
) {
  const localRecorderSpeakerLabel = speakerId
    ? localRecorderSpeakerLabels.labelsBySpeakerId.get(speakerId)
    : null;

  if (localRecorderSpeakerLabel) {
    return localRecorderSpeakerLabel;
  }

  const localRecorderSpeaker = formatLocalRecorderSpeaker({
    endMs,
    labelRemoteSpeakerByActivity:
      localRecorderSpeakerLabels.labelRemoteSpeakerByActivity,
    localRecorderAttribution,
    startMs,
  });

  if (localRecorderSpeaker) {
    return localRecorderSpeaker;
  }

  if (!speakerId) {
    return null;
  }

  const fallback = formatFallbackSpeaker(speakerId);
  const participant = findDominantParticipant({
    endMs,
    participantTimeline,
    startMs,
  });

  const participantName = participant
    ? getPreferredParticipantSpeakerName(participant)
    : null;

  if (participantName) {
    return isSharedMicrophoneName(participantName)
      ? `${participantName} · ${fallback}`
      : participantName;
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
