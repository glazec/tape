import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { fetchAndPersistRecallParticipantTimeline } from "@/lib/meeting-participant-timeline";
import { isRecallBotAccepted } from "@/lib/meeting-bot-lineage";
import { getRecallRecordingReadiness } from "@/lib/recall-recording-readiness";
import { isRecallDesktopSdkFallbackIntent } from "@/lib/local-recorder-records";
import { createRecallRecordingTranscription } from "@/lib/transcription-records";
import type { normalizeRecallWebhook } from "@/lib/vendors/recall";
import {
  findRecallRecordingMediaUrl,
  findRecallRecordingTiming,
  findRecallSpeakerTimelineUrl,
  retrieveRecallBot,
  retrieveRecallRecording,
} from "@/lib/vendors/recall";

type RecallWebhookEvent = ReturnType<typeof normalizeRecallWebhook>;

const terminalRecallStatusCodes = new Set([
  "failed",
  "fatal",
  "error",
  "cancel",
  "canceled",
  "cancelled",
]);
const completedRecallStatusCodes = new Set(["done", "complete", "completed"]);

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

  if (
    update.recallBotId &&
    !(await isRecallBotAccepted({
      botId: update.recallBotId,
      meetingId: update.meetingId,
    }))
  ) {
    return { action: "skip" as const, reason: "stale_bot" as const };
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
      return {
        action: "skip" as const,
        reason: "local_fallback_active" as const,
      };
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

  const shouldQueueTranscription =
    status === "processing" && shouldQueueRecallRecordingTranscription(event);
  const shouldQueueVideoFrames = shouldQueueRecallVideoFrames(event);

  if (
    update.recallRecordingId &&
    (shouldQueueTranscription || shouldQueueVideoFrames)
  ) {
    await queueRecallRecordingProcessing(update, event.metadata, {
      shouldQueueTranscription,
      shouldQueueVideoFrames,
      videoFrameReadiness: getVideoFrameReadiness(event),
    });
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
    eventType === "sdk_upload.complete" ||
    eventType === "video_mixed.done" ||
    subCode === "recording_done"
  );
}

async function queueRecallRecordingProcessing(
  update: Extract<RecallMeetingUpdate, { action: "update" }>,
  metadata: Record<string, unknown>,
  options: {
    shouldQueueTranscription: boolean;
    shouldQueueVideoFrames: boolean;
    videoFrameReadiness: string;
  },
) {
  if (!update.recallRecordingId) {
    return;
  }

  const recallArtifact = update.recallBotId
    ? await retrieveRecallBot(update.recallBotId)
    : update.recallRecordingId
      ? await retrieveRecallRecording(update.recallRecordingId)
      : null;

  if (!recallArtifact) {
    throw new Error("Recall recording is not available");
  }

  const readiness = update.recallBotId
    ? await getRecallRecordingReadiness(
        recallArtifact,
        update.recallRecordingId,
      )
    : null;

  if (readiness?.action === "wait") {
    if (
      readiness.reason === "media_unavailable" &&
      hasTerminalRecallMediaFailure(recallArtifact, update.recallRecordingId)
    ) {
      await db
        .update(meetings)
        .set({
          status: "failed",
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, update.meetingId));
      return;
    }

    throw new Error(`Recall recording is not ready: ${readiness.reason}`);
  }

  const audioUrl =
    readiness?.action === "ready"
      ? readiness.audioUrl
      : findRecallRecordingMediaUrl(recallArtifact, update.recallRecordingId);
  const speakerTimelineUrl = findRecallSpeakerTimelineUrl(
    recallArtifact,
    update.recallRecordingId,
  );

  if (!audioUrl) {
    if (
      hasTerminalRecallMediaFailure(recallArtifact, update.recallRecordingId)
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

  if (options.shouldQueueVideoFrames) {
    await inngest.send({
      id: `video-frames:${update.recallRecordingId}:${options.videoFrameReadiness}`,
      name: "meeting/extract.video-frames",
      data: {
        meetingId: update.meetingId,
        recallRecordingId: update.recallRecordingId,
        ...(update.recallBotId
          ? { recallBotId: update.recallBotId }
          : {}),
      },
    });
  }

  if (options.shouldQueueTranscription && speakerTimelineUrl) {
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

  if (!options.shouldQueueTranscription) {
    return;
  }

  const recordingTiming =
    readiness?.action === "ready"
      ? {
          durationMs: readiness.durationMs,
          endedAt: readiness.endedAt,
          startedAt: readiness.startedAt,
        }
      : findRecallRecordingTiming(recallArtifact, update.recallRecordingId);
  const transcription = await createRecallRecordingTranscription({
    ...(recordingTiming ?? {}),
    externalBotId: update.recallBotId ?? undefined,
    externalRecordingId: update.recallRecordingId,
    meetingId: update.meetingId,
    mode: getMetadataBoolean(metadata, "resumeRecording", "resume_recording")
      ? "append"
      : "replace",
  });

  if (transcription.shouldQueue === false) {
    return;
  }

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
  if (!recordingId) {
    return false;
  }

  const recording = findRecallRecordingRecord(recallArtifact, recordingId);

  if (!recording) {
    return false;
  }

  const recordingStatus = getRecallStatusCode(recording.status);

  if (terminalRecallStatusCodes.has(recordingStatus)) {
    return true;
  }

  if (!completedRecallStatusCodes.has(recordingStatus)) {
    return false;
  }

  const mediaShortcuts = getUnknownRecord(recording.media_shortcuts);

  return ["audio_mixed", "video_mixed"].some((shortcut) =>
    terminalRecallStatusCodes.has(
      getRecallStatusCode(getUnknownRecord(mediaShortcuts?.[shortcut])?.status),
    ),
  );
}

function findRecallRecordingRecord(
  recallArtifact: unknown,
  recordingId: string,
) {
  const artifact = getUnknownRecord(recallArtifact);

  if (!artifact) {
    return null;
  }

  if (artifact.id === recordingId) {
    return artifact;
  }

  const recordings = Array.isArray(artifact.recordings)
    ? artifact.recordings
    : [];
  return (
    recordings
      .map(getUnknownRecord)
      .find((recording) => recording?.id === recordingId) ?? null
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

function getMetadataBoolean(
  metadata: Record<string, unknown>,
  ...keys: string[]
) {
  return keys.some((key) => {
    const value = metadata[key];

    return value === true || value === "true";
  });
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
