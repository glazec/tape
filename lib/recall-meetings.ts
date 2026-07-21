import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, transcriptJobs } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { fetchAndPersistRecallParticipantTimeline } from "@/lib/meeting-participant-timeline";
import { isRecallDesktopSdkFallbackIntent } from "@/lib/local-recorder-records";
import { createRecallRecordingTranscription } from "@/lib/transcription-records";
import type { normalizeRecallWebhook } from "@/lib/vendors/recall";
import {
  findRecallRecordingMediaUrl,
  findRecallSpeakerTimelineUrl,
  retrieveRecallBot,
  retrieveRecallRecording,
} from "@/lib/vendors/recall";

type RecallWebhookEvent = ReturnType<typeof normalizeRecallWebhook>;

type RecallMeetingUpdate =
  | {
      action: "update";
      meetingId: string;
      recallBotId: string | null;
      recallRecordingId: string | null;
      status:
        | "scheduled"
        | "recording"
        | "processing"
        | "failed"
        | "missed"
        | null;
    }
  | {
      action: "skip";
      reason: "missing_meeting_id";
    };

export function buildRecallMeetingUpdate(
  event: RecallWebhookEvent,
): RecallMeetingUpdate {
  const meetingId = getMetadataString(
    event.metadata,
    "meetingId",
    "meeting_id",
  );

  if (!meetingId) {
    return { action: "skip", reason: "missing_meeting_id" };
  }

  return {
    action: "update",
    meetingId,
    recallBotId: event.botId,
    recallRecordingId: event.recordingId,
    status: mapRecallStatus(event),
  };
}

export async function applyRecallMeetingEvent(event: RecallWebhookEvent) {
  const update = buildRecallMeetingUpdate(event);

  if (update.action === "skip") {
    return update;
  }

  const status =
    update.status === "missed" && (await hasRecordingEvidence(update.meetingId))
      ? null
      : update.status;

  if (
    event.eventType.toLowerCase().startsWith("sdk_upload.") &&
    getMetadataString(event.metadata, "source") === "local_recorder_sdk"
  ) {
    const fallbackIntentId = getMetadataString(
      event.metadata,
      "fallbackIntentId",
      "fallback_intent_id",
    );

    if (
      fallbackIntentId &&
      (await isRecallDesktopSdkFallbackIntent(fallbackIntentId))
    ) {
      return { action: "skip" as const, reason: "local_fallback_active" as const };
    }
  }

  await db
    .update(meetings)
    .set({
      recallBotId: update.recallBotId ?? undefined,
      recallRecordingId: update.recallRecordingId ?? undefined,
      status: status ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, update.meetingId));

  if (
    update.recallBotId &&
    update.recallRecordingId &&
    shouldQueueRecallVideoFrames(event)
  ) {
    await inngest.send({
      id: `video-frames:${update.recallRecordingId}:${getVideoFrameReadiness(event)}`,
      name: "meeting/extract.video-frames",
      data: {
        meetingId: update.meetingId,
        recallBotId: update.recallBotId,
        recallRecordingId: update.recallRecordingId,
      },
    });
  }

  if (
    status === "processing" &&
    (update.recallBotId || update.recallRecordingId) &&
    shouldQueueRecallRecordingTranscription(event)
  ) {
    await queueRecallRecordingTranscription(update);
  }

  return update;
}

function shouldQueueRecallRecordingTranscription(event: RecallWebhookEvent) {
  const eventType = event.eventType.toLowerCase();
  const subCode = event.subCode?.toLowerCase() ?? "";

  return (
    eventType === "recording.done" ||
    eventType === "sdk_upload.complete" ||
    subCode === "recording_done"
  );
}

function getVideoFrameReadiness(event: RecallWebhookEvent) {
  return event.eventType.toLowerCase() === "video_mixed.done" ||
    event.subCode?.toLowerCase() === "video_mixed_done"
    ? "video-mixed"
    : "recording";
}

function shouldQueueRecallVideoFrames(event: RecallWebhookEvent) {
  const eventType = event.eventType.toLowerCase();
  const subCode = event.subCode?.toLowerCase() ?? "";

  return (
    eventType === "recording.done" ||
    eventType === "video_mixed.done" ||
    subCode === "recording_done"
  );
}

async function queueRecallRecordingTranscription(
  update: Extract<RecallMeetingUpdate, { action: "update" }>,
) {
  if (await hasActiveTranscriptJob(update.meetingId)) {
    return;
  }

  const recallArtifact = update.recallBotId
    ? await retrieveRecallBot(update.recallBotId)
    : update.recallRecordingId
      ? await retrieveRecallRecording(update.recallRecordingId)
      : null;

  if (!recallArtifact) {
    return;
  }

  const audioUrl = findRecallRecordingMediaUrl(
    recallArtifact,
    update.recallRecordingId,
  );
  const speakerTimelineUrl = findRecallSpeakerTimelineUrl(
    recallArtifact,
    update.recallRecordingId,
  );

  if (!audioUrl) {
    if (
      hasTerminalRecallMediaFailure(
        recallArtifact,
        update.recallRecordingId,
      )
    ) {
      await db
        .update(meetings)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, update.meetingId));
    }

    return;
  }

  if (speakerTimelineUrl) {
    if (update.recallBotId) {
      try {
        await fetchAndPersistRecallParticipantTimeline({
          meetingId: update.meetingId,
          timelineUrl: speakerTimelineUrl,
        });
      } catch {
        // Preserve legacy bot behavior when speaker media is not ready yet.
      }
    } else {
      await fetchAndPersistRecallParticipantTimeline({
        meetingId: update.meetingId,
        timelineUrl: speakerTimelineUrl,
      });
    }
  }

  const transcription = await createRecallRecordingTranscription({
    meetingId: update.meetingId,
  });

  await inngest.send({
    name: "meeting/transcribe.audio",
    data: {
      audioUrl,
      ...transcription,
    },
  });
}

function hasTerminalRecallMediaFailure(
  recallArtifact: unknown,
  recordingId: string | null,
) {
  const recording = findRecallRecordingRecord(recallArtifact, recordingId);

  if (!recording) {
    return false;
  }

  const recordingStatus = getRecallStatusCode(recording.status);

  if (/(fail|error|cancel)/.test(recordingStatus)) {
    return true;
  }

  if (!/(done|complete)/.test(recordingStatus)) {
    return false;
  }

  const mediaShortcuts = getUnknownRecord(recording.media_shortcuts);

  return ["audio_mixed", "video_mixed"].some((shortcut) =>
    /(fail|error|cancel)/.test(
      getRecallStatusCode(getUnknownRecord(mediaShortcuts?.[shortcut])?.status),
    ),
  );
}

function findRecallRecordingRecord(
  recallArtifact: unknown,
  recordingId: string | null,
) {
  const artifact = getUnknownRecord(recallArtifact);

  if (!artifact) {
    return null;
  }

  if (recordingId && artifact.id === recordingId) {
    return artifact;
  }

  const recordings = Array.isArray(artifact.recordings)
    ? artifact.recordings
    : [];
  const recordingRecords = recordings.map(getUnknownRecord);

  if (!recordingId) {
    return artifact.media_shortcuts
      ? artifact
      : recordingRecords.find(Boolean) ?? artifact;
  }

  return (
    recordingRecords.find((recording) => recording?.id === recordingId) ?? null
  );
}

function getRecallStatusCode(value: unknown) {
  const status = getUnknownRecord(value);
  const code = status?.code;

  return typeof code === "string" ? code.toLowerCase() : "";
}

function getUnknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

async function hasActiveTranscriptJob(meetingId: string) {
  const rows = await db
    .select({ id: transcriptJobs.id })
    .from(transcriptJobs)
    .where(
      and(
        eq(transcriptJobs.meetingId, meetingId),
        inArray(transcriptJobs.status, ["queued", "running", "completed"]),
      ),
    )
    .limit(1);

  return Boolean(rows[0]);
}

async function hasRecordingEvidence(meetingId: string) {
  const rows = await db
    .select({
      recallRecordingId: meetings.recallRecordingId,
      status: meetings.status,
    })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return false;
  }

  if (row.recallRecordingId) {
    return true;
  }

  // A recording already carried this meeting past capture — most commonly a
  // local-recorder fallback upload, which sets status without ever setting
  // recallRecordingId. A late or out-of-order bot.done (no recording id) must
  // not revert such a meeting to "missed".
  return row.status === "processing" || row.status === "ready";
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

function mapRecallStatus(event: RecallWebhookEvent) {
  const statusText = [
    event.statusCode,
    event.code,
    event.subCode,
    event.eventType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (isRecallMissedRecording(event)) {
    return "missed";
  }

  if (/(fatal|fail|error)/.test(statusText)) {
    return "failed";
  }

  if (/recording_done|\bdone\b|complete/.test(statusText)) {
    if (!event.recordingId && event.eventType === "bot.done") {
      return "missed";
    }

    return "processing";
  }

  if (/recording|in_call|joining|joined/.test(statusText)) {
    return "recording";
  }

  return null;
}

function isRecallMissedRecording(event: RecallWebhookEvent) {
  if (event.recordingId) {
    return false;
  }

  const code = (event.code ?? event.statusCode ?? "").toLowerCase();
  const eventType = event.eventType.toLowerCase();

  return (
    code === "call_ended" ||
    code === "fatal" ||
    eventType === "bot.call_ended" ||
    eventType === "bot.fatal"
  );
}
