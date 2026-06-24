import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { createRecallRecordingTranscription } from "@/lib/transcription-records";
import type { normalizeRecallWebhook } from "@/lib/vendors/recall";
import {
  findRecallRecordingMediaUrl,
  retrieveRecallBot,
} from "@/lib/vendors/recall";

type RecallWebhookEvent = ReturnType<typeof normalizeRecallWebhook>;

type RecallMeetingUpdate =
  | {
      action: "update";
      meetingId: string;
      recallBotId: string | null;
      recallRecordingId: string | null;
      status: "scheduled" | "recording" | "processing" | "failed" | null;
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

  await db
    .update(meetings)
    .set({
      recallBotId: update.recallBotId ?? undefined,
      recallRecordingId: update.recallRecordingId ?? undefined,
      status: update.status ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, update.meetingId));

  if (update.status === "processing" && update.recallBotId) {
    await queueRecallRecordingTranscription({
      ...update,
      recallBotId: update.recallBotId,
    });
  }

  return update;
}

async function queueRecallRecordingTranscription(
  update: Extract<RecallMeetingUpdate, { action: "update" }> & {
    recallBotId: string;
  },
) {
  const bot = await retrieveRecallBot(update.recallBotId);
  const audioUrl = findRecallRecordingMediaUrl(bot, update.recallRecordingId);

  if (!audioUrl) {
    return;
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

  if (/(fatal|fail|error)/.test(statusText)) {
    return "failed";
  }

  if (/recording_done|done|ended|complete/.test(statusText)) {
    return "processing";
  }

  if (/recording|in_call|joining|joined/.test(statusText)) {
    return "recording";
  }

  return null;
}
