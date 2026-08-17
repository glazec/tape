import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { databaseSql, db } from "@/db/client";
import {
  calendarEvents,
  localRecordings,
  meetings,
  transcriptJobs,
  users,
} from "@/db/schema";
import { normalizeEmailDomain } from "@/lib/access";
import { activeTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
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
import { recordElevenLabsTranscriptUsage } from "@/lib/provider-usage";
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
  const recordingId =
    getMetadataString(event.metadata, "recordingId", "recording_id") ??
    undefined;

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

  const words =
    "transcriptionWords" in event ? event.transcriptionWords : undefined;
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

  const meetingId = getMetadataString(
    event.metadata,
    "meetingId",
    "meeting_id",
  );

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
  const meetingId = getMetadataString(
    event.metadata,
    "meetingId",
    "meeting_id",
  );
  const transcriptJobId = getMetadataString(
    event.metadata,
    "transcriptJobId",
    "transcript_job_id",
  );

  if (
    meetingId &&
    transcriptJobId &&
    !(await shouldApplyTranscriptJob(meetingId, transcriptJobId))
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

  if (persistence.action === "fail") {
    await db
      .update(transcriptJobs)
      .set({
        ...(persistence.errorMessage
          ? { errorMessage: persistence.errorMessage }
          : {}),
        ...(persistence.providerJobId
          ? { providerJobId: persistence.providerJobId }
          : {}),
        status: "failed",
        updatedAt: now,
      })
      .where(eq(transcriptJobs.id, persistence.transcriptJobId));

    await recordElevenLabsTranscriptUsage({
      transcriptJobId: persistence.transcriptJobId,
    });

    if (meetingId) {
      return {
        ...persistence,
        meetingFinalized: await finalizeMeetingTranscriptGeneration(
          meetingId,
          now,
        ),
      };
    }

    return { ...persistence, meetingFinalized: false };
  }

  const applicationContext = await loadTranscriptApplicationContext(
    persistence.meetingId,
    persistence.transcriptJobId,
  );
  const segmentOffsetMs = getTranscriptSegmentOffsetMs(applicationContext);

  const replaceMeetingTranscript =
    applicationContext.mode === "replace" && !persistence.recordingId;
  const segmentRows = persistence.segments.map((segment) => ({
    emotion_label: segment.emotionLabel ?? null,
    emotion_reason: segment.emotionReason ?? null,
    end_ms: segment.endMs === null ? null : segment.endMs + segmentOffsetMs,
    id: randomUUID(),
    speaker: segment.speaker,
    start_ms: segment.startMs + segmentOffsetMs,
    text: segment.text,
  }));
  const segmentIdByReference = new Map(
    segmentRows.map((segment, index) => [`segment_${index}`, segment.id]),
  );
  const entityRows = persistence.entities.map((entity) => ({
    aliases: entity.aliases,
    normalized_value: entity.normalizedValue,
    segment_id: entity.segmentId
      ? (segmentIdByReference.get(entity.segmentId) ?? null)
      : null,
    source: entity.source,
    type: entity.type,
    value: entity.value,
  }));

  const transcriptDurationMs = persistence.segments.reduce(
    (maximum, segment) => Math.max(maximum, segment.endMs ?? segment.startMs),
    0,
  );

  await databaseSql.transaction((txn) => [
    txn`
      delete from meeting_entities
      where ${replaceMeetingTranscript}
        and meeting_id = ${persistence.meetingId}::uuid
    `,
    txn`
      delete from transcript_segments
      where (
        ${replaceMeetingTranscript}
        and meeting_id = ${persistence.meetingId}::uuid
      ) or (
        not ${replaceMeetingTranscript}
        and job_id = ${persistence.transcriptJobId}::uuid
      )
    `,
    txn`
      insert into transcript_segments (
        id,
        meeting_id,
        job_id,
        speaker,
        start_ms,
        end_ms,
        text,
        emotion_label,
        emotion_reason
      )
      select
        segment.id,
        ${persistence.meetingId}::uuid,
        ${persistence.transcriptJobId}::uuid,
        segment.speaker,
        segment.start_ms,
        segment.end_ms,
        segment.text,
        segment.emotion_label,
        segment.emotion_reason
      from jsonb_to_recordset(${JSON.stringify(segmentRows)}::jsonb) as segment(
        id uuid,
        speaker text,
        start_ms integer,
        end_ms integer,
        text text,
        emotion_label text,
        emotion_reason text
      )
    `,
    txn`
      insert into meeting_entities (
        meeting_id,
        segment_id,
        type,
        value,
        normalized_value,
        aliases,
        source
      )
      select
        ${persistence.meetingId}::uuid,
        entity.segment_id,
        entity.type,
        entity.value,
        entity.normalized_value,
        entity.aliases,
        entity.source
      from jsonb_to_recordset(${JSON.stringify(entityRows)}::jsonb) as entity(
        segment_id uuid,
        type text,
        value text,
        normalized_value text,
        aliases jsonb,
        source text
      )
      on conflict (meeting_id, type, normalized_value) do nothing
    `,
    txn`
      update recordings
      set duration_ms = ${transcriptDurationMs}, updated_at = ${now}
      where id = ${persistence.recordingId ?? null}::uuid
        and ${transcriptDurationMs} > 0
        and duration_ms is null
    `,
    txn`
      update transcript_jobs
      set
        provider_job_id = coalesce(
          ${persistence.providerJobId ?? null}::text,
          provider_job_id
        ),
        status = 'completed',
        updated_at = ${now}
      where id = ${persistence.transcriptJobId}::uuid
    `,
  ]);

  await recordElevenLabsTranscriptUsage({
    fallbackDurationMs: transcriptDurationMs,
    transcriptJobId: persistence.transcriptJobId,
  });

  return {
    ...persistence,
    meetingFinalized: await finalizeMeetingTranscriptGeneration(
      persistence.meetingId,
      now,
    ),
  };
}

export async function finalizeMeetingTranscriptGeneration(
  meetingId: string,
  now: Date,
) {
  const rows = await databaseSql`
    with latest_replace as (
      select id, created_at, generation_id
      from transcript_jobs
      where meeting_id = ${meetingId}::uuid
        and mode = 'replace'
      order by created_at desc, id desc
      limit 1
    ), active_generation as (
      select active_job.id, active_job.status
      from transcript_jobs active_job
      where active_job.meeting_id = ${meetingId}::uuid
        and (
          active_job.id = (select id from latest_replace)
          or (
          active_job.mode = 'append'
          and (
              active_job.generation_id = (
                select generation_id from latest_replace
              )
              or (
                active_job.generation_id is null
                and (
                  active_job.created_at > (select created_at from latest_replace)
                  or (
                    active_job.created_at = (select created_at from latest_replace)
                    and active_job.id > (select id from latest_replace)
                  )
                )
              )
            )
          )
        )
    )
    update meetings
    set
      status = case
        when exists (
          select 1 from active_generation where status = 'failed'
        ) then 'failed'::meeting_status
        else 'ready'::meeting_status
      end,
      updated_at = ${now}
    where id = ${meetingId}::uuid
      and status = 'processing'
      and not exists (
        select 1
        from active_generation
        where status in ('queued', 'running')
      )
    returning status
  `;

  return Boolean(
    rows?.some((row: { status?: string }) => row.status === "ready"),
  );
}

async function shouldApplyTranscriptJob(
  meetingId: string,
  transcriptJobId: string,
) {
  const result = await db.execute<{
    current_mode: string;
    current_status: string;
    id: string;
    recording_id: string | null;
  }>(sql`
    select
      latest.id,
      current.mode as current_mode,
      current.status as current_status,
      current.recording_id
    from transcript_jobs current
    left join lateral (
      select id
      from transcript_jobs
      where meeting_id = ${meetingId}::uuid
      order by created_at desc, id desc
      limit 1
    ) latest on true
    where current.id = ${transcriptJobId}::uuid
  `);

  return isTranscriptJobApplicable(result.rows[0], transcriptJobId);
}

export function isTranscriptJobApplicable(
  row:
    | {
        current_mode: string;
        current_status: string;
        id: string;
        recording_id: string | null;
      }
    | undefined,
  transcriptJobId: string,
) {
  return (
    row?.current_status !== "completed" &&
    (typeof row?.recording_id === "string" ||
      row?.current_mode === "append" ||
      row?.id === transcriptJobId)
  );
}

type TranscriptApplicationContext = {
  firstRecordingStartedAt: Date | string | null;
  mode: "append" | "replace";
  recordingOffsetMs?: number | string | null;
  recordingStartedAt: Date | string | null;
};

async function loadTranscriptApplicationContext(
  meetingId: string,
  transcriptJobId: string,
): Promise<TranscriptApplicationContext> {
  const result = await db.execute<{
    first_recording_started_at: Date | string | null;
    mode: "append" | "replace";
    recording_offset_ms: number | string | null;
    recording_started_at: Date | string | null;
  }>(sql`
    select
      transcript_jobs.mode,
      recordings.started_at as recording_started_at,
      (
        select case
          when count(*) filter (
            where prior_recording.duration_ms is null
          ) > 0 then null
          else coalesce(sum(prior_recording.duration_ms), 0)
        end
        from transcript_jobs prior_job
        inner join recordings prior_recording
          on prior_recording.id = prior_job.recording_id
        where prior_job.id in ${activeTranscriptJobIdsSubquery(meetingId)}
          and (
            prior_job.created_at < transcript_jobs.created_at
            or (
              prior_job.created_at = transcript_jobs.created_at
              and prior_job.id < transcript_jobs.id
            )
          )
      ) as recording_offset_ms,
      (
        select min(first_recording.started_at)
        from recordings first_recording
        where first_recording.meeting_id = ${meetingId}::uuid
          and first_recording.source = recordings.source
      ) as first_recording_started_at
    from transcript_jobs
    left join recordings on recordings.id = transcript_jobs.recording_id
    where transcript_jobs.id = ${transcriptJobId}::uuid
    limit 1
  `);
  const row = result.rows[0];

  return {
    firstRecordingStartedAt: row?.first_recording_started_at ?? null,
    mode: row?.mode === "append" ? "append" : "replace",
    recordingOffsetMs: row?.recording_offset_ms ?? null,
    recordingStartedAt: row?.recording_started_at ?? null,
  };
}

export function getTranscriptSegmentOffsetMs(
  context: TranscriptApplicationContext,
) {
  const recordingOffsetMs = Number(context.recordingOffsetMs);

  if (
    context.mode === "append" &&
    context.recordingOffsetMs !== null &&
    context.recordingOffsetMs !== undefined &&
    Number.isFinite(recordingOffsetMs) &&
    recordingOffsetMs >= 0
  ) {
    return recordingOffsetMs;
  }

  if (
    context.mode !== "append" ||
    !context.recordingStartedAt ||
    !context.firstRecordingStartedAt
  ) {
    return 0;
  }

  const recordingStartedAt = new Date(context.recordingStartedAt).getTime();
  const firstRecordingStartedAt = new Date(
    context.firstRecordingStartedAt,
  ).getTime();

  if (
    !Number.isFinite(recordingStartedAt) ||
    !Number.isFinite(firstRecordingStartedAt)
  ) {
    return 0;
  }

  return Math.max(0, recordingStartedAt - firstRecordingStartedAt);
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

function getMetadataList(metadata: Record<string, unknown>, ...keys: string[]) {
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
  const rows = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      calendarMeetingUrl: calendarEvents.meetingUrl,
      meetingUrl: meetings.meetingUrl,
      ownerEmail: users.email,
      teamId: meetings.teamId,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .leftJoin(users, eq(users.id, meetings.ownerUserId))
    .where(eq(meetings.id, meetingId))
    .limit(1);
  const row = rows[0];
  const organizationDomains = row
    ? await getTwentyCrmCompanyDomains(row.teamId)
    : [];

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
        eq(
          localRecordings.synthesizedAudioAssetId,
          transcriptJobs.mediaAssetId,
        ),
      )
      .innerJoin(users, eq(users.id, localRecordings.ownerUserId))
      .where(eq(transcriptJobs.id, transcriptJobId))
      .limit(1);
  } catch {
    return null;
  }

  const activityWindows = parseLocalRecorderActivityWindows(
    recording?.manifest,
  );

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
      attendeeEmails.length > 0
        ? attendeeEmails
        : (context.attendeeEmails ?? []),
    meetingUrl:
      getMetadataString(event.metadata, "meetingUrl", "meeting_url") ??
      context.meetingUrl ??
      null,
    organizationDomains: context.organizationDomains ?? [],
    transcriptEntities:
      "transcriptionEntities" in event
        ? (event.transcriptionEntities as
            | TranscriptDetectedEntity[]
            | undefined)
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

  return speakerId.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
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
  const endMs =
    input.endMs && input.endMs > startMs ? input.endMs : startMs + 1;
  let best: {
    entry: ParticipantTimelineEntry;
    overlapMs: number;
  } | null = null;

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
  return typeof value === "number"
    ? Math.max(0, Math.round(value * 1000))
    : null;
}
