import { z } from "zod";
import { asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { transcriptJobs, transcriptSegments } from "@/db/schema";
import { inngest } from "./client";
import { createReadUrl } from "@/lib/r2";
import { sendDueLocationReminders } from "@/lib/location-reminders";
import { getMeetingVocabularyKeyterms } from "@/lib/team-vocabulary";
import { createElevenLabsTranscriptJob } from "@/lib/vendors/elevenlabs";
import { translateTranscriptSegmentsToChinese } from "@/lib/vendors/openrouter";
import { scheduleRecallBot } from "@/lib/vendors/recall";

const appUrlSchema = z.string().trim().url();

const scheduleMeetingBotDataSchema = z.object({
  meetingUrl: z.string().url(),
  startAt: z.string().datetime().optional(),
});

const transcribeAudioDataSchema = z.union([
  z.object({
    audioUrl: z.string().url(),
    meetingId: z.string().uuid().optional(),
    mediaAssetId: z.string().uuid().optional(),
    transcriptJobId: z.string().uuid().optional(),
  }),
  z.object({
    objectKey: z.string().min(1),
    meetingId: z.string().uuid().optional(),
    mediaAssetId: z.string().uuid().optional(),
    transcriptJobId: z.string().uuid().optional(),
  }),
]);
const enrichTranscriptDataSchema = z.object({
  meetingId: z.string().uuid(),
});

function getAppUrl() {
  return appUrlSchema.parse(process.env.NEXT_PUBLIC_APP_URL);
}

export const scheduleMeetingBot = inngest.createFunction(
  { id: "schedule-meeting-bot", triggers: [{ event: "meeting/schedule.bot" }] },
  async ({ event }) => {
    const data = scheduleMeetingBotDataSchema.parse(event.data);
    const appUrl = getAppUrl();

    return scheduleRecallBot({
      meetingUrl: data.meetingUrl,
      startAt: data.startAt,
      webhookUrl: `${appUrl}/api/recall/webhook`,
    });
  },
);

export const transcribeAudio = inngest.createFunction(
  { id: "transcribe-audio", triggers: [{ event: "meeting/transcribe.audio" }] },
  async ({ event }) => {
    const data = transcribeAudioDataSchema.parse(event.data);
    const appUrl = getAppUrl();
    const audioUrl =
      "audioUrl" in data ? data.audioUrl : await createReadUrl({ key: data.objectKey });
    const keyterms = data.meetingId
      ? await getMeetingVocabularyKeyterms(data.meetingId)
      : [];

    const response = await createElevenLabsTranscriptJob({
      audioUrl,
      webhookUrl: `${appUrl}/api/elevenlabs/webhook`,
      keyterms,
      metadata: buildTranscriptMetadata(data),
    });

    const providerJobId = getProviderJobId(response);

    if (data.transcriptJobId) {
      await db
        .update(transcriptJobs)
        .set({
          providerJobId,
          status: providerJobId ? "running" : "queued",
          updatedAt: new Date(),
        })
        .where(eq(transcriptJobs.id, data.transcriptJobId));
    }

    return response;
  },
);

export const enrichTranscript = inngest.createFunction(
  {
    id: "enrich-transcript",
    triggers: [{ event: "meeting/enrich.transcript" }],
  },
  async ({ event }) => {
    const data = enrichTranscriptDataSchema.parse(event.data);
    const segments = await db
      .select({
        id: transcriptSegments.id,
        text: transcriptSegments.text,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, data.meetingId))
      .orderBy(asc(transcriptSegments.startMs));
    const translations = await translateTranscriptSegmentsToChinese(segments);

    for (const translation of translations) {
      await db
        .update(transcriptSegments)
        .set({
          translatedText: translation.text,
          updatedAt: new Date(),
        })
        .where(eq(transcriptSegments.id, translation.id));
    }

    return { translatedCount: translations.length };
  },
);

export const sendLocationReminders = inngest.createFunction(
  {
    id: "send-location-reminders",
    triggers: [{ event: "meeting/send.location-reminders" }],
  },
  async () => sendDueLocationReminders(),
);

export const functions = [
  scheduleMeetingBot,
  transcribeAudio,
  enrichTranscript,
  sendLocationReminders,
];

function buildTranscriptMetadata(data: z.infer<typeof transcribeAudioDataSchema>) {
  const metadata: Record<string, string> = {};

  if ("objectKey" in data) {
    metadata.objectKey = data.objectKey;
  }

  if (data.meetingId) {
    metadata.meetingId = data.meetingId;
  }

  if (data.mediaAssetId) {
    metadata.mediaAssetId = data.mediaAssetId;
  }

  if (data.transcriptJobId) {
    metadata.transcriptJobId = data.transcriptJobId;
  }

  return metadata;
}

function getProviderJobId(response: unknown) {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidate = response as Record<string, unknown>;

  if (typeof candidate.request_id === "string") {
    return candidate.request_id;
  }

  if (typeof candidate.id === "string") {
    return candidate.id;
  }

  return null;
}
