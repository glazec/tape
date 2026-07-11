import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { meetingParticipantTimeline } from "@/db/schema";

export type ParticipantTimelineEntry = {
  participantId: string | null;
  name: string | null;
  email: string | null;
  startMs: number;
  endMs: number | null;
};

type RecallRealtimeParticipantTimelineEntry = ParticipantTimelineEntry & {
  meetingId: string;
};

type RecallRealtimeParticipantTimelineUpdate =
  | {
      action: "speech_on";
      entry: RecallRealtimeParticipantTimelineEntry;
    }
  | {
      action: "speech_off";
      entry: RecallRealtimeParticipantTimelineEntry;
    }
  | {
      action: "skip";
      reason:
        | "missing_meeting_id"
        | "missing_participant"
        | "missing_timestamp"
        | "unsupported_event";
    };

export async function fetchAndPersistRecallParticipantTimeline(input: {
  meetingId: string;
  timelineUrl: string;
}) {
  const response = await fetch(input.timelineUrl);

  if (!response.ok) {
    throw new Error(
      `Recall speaker timeline fetch failed with ${response.status} ${response.statusText}`,
    );
  }

  const timeline = parseRecallParticipantTimeline(await response.json());

  await persistMeetingParticipantTimeline({
    meetingId: input.meetingId,
    timeline,
  });

  return { count: timeline.length };
}

export function parseRecallParticipantTimeline(
  payload: unknown,
): ParticipantTimelineEntry[] {
  const records = getTimelineRecords(payload);
  const entries: ParticipantTimelineEntry[] = [];

  for (const record of records) {
    if (!record || typeof record !== "object") {
      continue;
    }

    const item = record as Record<string, unknown>;
    const participant = getRecord(item.participant) ?? getRecord(item.speaker);
    const participantId =
      getIdString(item.participant_id) ??
      getIdString(item.participantId) ??
      getIdString(participant?.id) ??
      getIdString(item.id);
    const name =
      getString(item.name) ??
      getString(item.participant_name) ??
      getString(item.participantName) ??
      getString(participant?.name);
    const email =
      getString(item.email) ??
      getString(item.participant_email) ??
      getString(item.participantEmail) ??
      getString(participant?.email);
    const startMs =
      getMilliseconds(item, ["start_ms", "startMs", "start_time_ms"]) ??
      getRelativeTimestampAsMilliseconds(item, [
        "start_timestamp",
        "startTimestamp",
      ]) ??
      getSecondsAsMilliseconds(item, ["start", "start_time", "startTime"]);
    const endMs =
      getMilliseconds(item, ["end_ms", "endMs", "end_time_ms"]) ??
      getRelativeTimestampAsMilliseconds(item, [
        "end_timestamp",
        "endTimestamp",
      ]) ??
      getSecondsAsMilliseconds(item, ["end", "end_time", "endTime"]);

    if (startMs === null || (!participantId && !name && !email)) {
      continue;
    }

    entries.push({
      participantId,
      name,
      email,
      startMs,
      endMs,
    });
  }

  return entries.sort((left, right) => left.startMs - right.startMs);
}

export async function persistMeetingParticipantTimeline(input: {
  meetingId: string;
  timeline: ParticipantTimelineEntry[];
}) {
  await db
    .delete(meetingParticipantTimeline)
    .where(eq(meetingParticipantTimeline.meetingId, input.meetingId));

  if (input.timeline.length === 0) {
    return;
  }

  await db.insert(meetingParticipantTimeline).values(
    input.timeline.map((entry) => ({
      meetingId: input.meetingId,
      recallParticipantId: entry.participantId,
      name: entry.name,
      email: entry.email,
      startMs: entry.startMs,
      endMs: entry.endMs,
      source: "recall",
    })),
  );
}

export async function persistRecallRealtimeParticipantTimelineEvent(
  payload: unknown,
) {
  const update = buildRecallRealtimeParticipantTimelineUpdate(payload);

  if (update.action === "skip") {
    return update;
  }

  if (update.action === "speech_on") {
    await db
      .insert(meetingParticipantTimeline)
      .values({
        meetingId: update.entry.meetingId,
        recallParticipantId: update.entry.participantId,
        name: update.entry.name,
        email: update.entry.email,
        startMs: update.entry.startMs,
        endMs: null,
        source: "recall_realtime",
      })
      .onConflictDoNothing({
        target: [
          meetingParticipantTimeline.meetingId,
          meetingParticipantTimeline.recallParticipantId,
          meetingParticipantTimeline.startMs,
        ],
      });

    return update;
  }

  const openEntry = await findOpenParticipantTimelineEntry(update.entry);

  if (openEntry) {
    await db
      .update(meetingParticipantTimeline)
      .set({
        email: update.entry.email ?? undefined,
        endMs: update.entry.endMs,
        name: update.entry.name ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(meetingParticipantTimeline.id, openEntry.id));
  }

  return update;
}

export function buildRecallRealtimeParticipantTimelineUpdate(
  payload: unknown,
): RecallRealtimeParticipantTimelineUpdate {
  const record = getRecord(payload);
  const event = getString(record?.event);

  if (
    event !== "participant_events.speech_on" &&
    event !== "participant_events.speech_off"
  ) {
    return { action: "skip", reason: "unsupported_event" };
  }

  const data = getRecord(record?.data);
  const eventData = getRecord(data?.data);
  const participant = getRecord(eventData?.participant);
  const participantId = getIdString(participant?.id);
  const name = getString(participant?.name);
  const email = getString(participant?.email);

  if (!participantId && !name && !email) {
    return { action: "skip", reason: "missing_participant" };
  }

  const meetingId = getRecallRealtimeMeetingId(data);

  if (!meetingId) {
    return { action: "skip", reason: "missing_meeting_id" };
  }

  const timestamp = getRelativeTimestampAsMilliseconds(eventData ?? {}, [
    "timestamp",
  ]);

  if (timestamp === null) {
    return { action: "skip", reason: "missing_timestamp" };
  }

  return {
    action:
      event === "participant_events.speech_on" ? "speech_on" : "speech_off",
    entry: {
      email,
      endMs: event === "participant_events.speech_off" ? timestamp : null,
      meetingId,
      name,
      participantId,
      startMs: timestamp,
    },
  };
}

export async function listMeetingParticipantTimeline(meetingId: string) {
  const rows = await db
    .select({
      participantId: meetingParticipantTimeline.recallParticipantId,
      name: meetingParticipantTimeline.name,
      email: meetingParticipantTimeline.email,
      startMs: meetingParticipantTimeline.startMs,
      endMs: meetingParticipantTimeline.endMs,
    })
    .from(meetingParticipantTimeline)
    .where(eq(meetingParticipantTimeline.meetingId, meetingId))
    .orderBy(asc(meetingParticipantTimeline.startMs));

  return rows;
}

async function findOpenParticipantTimelineEntry(
  entry: RecallRealtimeParticipantTimelineEntry,
) {
  if (entry.participantId) {
    const rows = await db
      .select({ id: meetingParticipantTimeline.id })
      .from(meetingParticipantTimeline)
      .where(
        and(
          eq(meetingParticipantTimeline.meetingId, entry.meetingId),
          eq(meetingParticipantTimeline.recallParticipantId, entry.participantId),
          isNull(meetingParticipantTimeline.endMs),
        ),
      )
      .orderBy(desc(meetingParticipantTimeline.startMs))
      .limit(1);

    return rows[0] ?? null;
  }

  if (entry.email) {
    const rows = await db
      .select({ id: meetingParticipantTimeline.id })
      .from(meetingParticipantTimeline)
      .where(
        and(
          eq(meetingParticipantTimeline.meetingId, entry.meetingId),
          eq(meetingParticipantTimeline.email, entry.email),
          isNull(meetingParticipantTimeline.endMs),
        ),
      )
      .orderBy(desc(meetingParticipantTimeline.startMs))
      .limit(1);

    return rows[0] ?? null;
  }

  if (entry.name) {
    const rows = await db
      .select({ id: meetingParticipantTimeline.id })
      .from(meetingParticipantTimeline)
      .where(
        and(
          eq(meetingParticipantTimeline.meetingId, entry.meetingId),
          eq(meetingParticipantTimeline.name, entry.name),
          isNull(meetingParticipantTimeline.endMs),
        ),
      )
      .orderBy(desc(meetingParticipantTimeline.startMs))
      .limit(1);

    return rows[0] ?? null;
  }

  return null;
}

function getRecallRealtimeMeetingId(data: Record<string, unknown> | null) {
  for (const artifactKey of [
    "recording",
    "bot",
    "participant_events",
    "realtime_endpoint",
  ]) {
    const artifact = getRecord(data?.[artifactKey]);
    const metadata = getRecord(artifact?.metadata);
    const meetingId = getString(metadata?.meetingId) ?? getString(metadata?.meeting_id);

    if (meetingId) {
      return meetingId;
    }
  }

  return null;
}

function getTimelineRecords(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;

  for (const key of ["timeline", "speaker_timeline", "segments", "data"]) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getIdString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return getString(value);
}

function getMilliseconds(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getNumber(record[key]);

    if (value !== null) {
      return Math.max(0, Math.round(value));
    }
  }

  return null;
}

function getSecondsAsMilliseconds(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = getNumber(record[key]);

    if (value !== null) {
      return Math.max(0, Math.round(value * 1000));
    }
  }

  return null;
}

function getRelativeTimestampAsMilliseconds(
  record: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const timestamp = getRecord(record[key]);
    const value = timestamp ? getNumber(timestamp.relative) : null;

    if (value !== null) {
      return Math.max(0, Math.round(value * 1000));
    }
  }

  return null;
}

function getNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
