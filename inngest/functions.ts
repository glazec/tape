import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { transcriptJobs, transcriptSegments } from "@/db/schema";
import { inngest } from "./client";
import { currentTranscriptJobIdSubquery } from "@/lib/current-transcript-job";
import { createReadUrl } from "@/lib/r2";
import { sendDueLocationReminders } from "@/lib/location-reminders";
import { getMeetingVocabularyKeyterms } from "@/lib/team-vocabulary";
import { createElevenLabsTranscriptJob } from "@/lib/vendors/elevenlabs";
import {
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationRunning,
} from "@/lib/meeting-translation-jobs";
import {
  polishTranscriptSegmentsInOriginalLanguage,
  TRANSLATION_BATCH_SIZE,
  translateTranscriptSegmentsToChinese,
} from "@/lib/vendors/openrouter";
import { scheduleRecallBot } from "@/lib/vendors/recall";
import { syncRecallCalendarEventsForAllConnectedUsers } from "@/lib/recall-calendar-bulk-sync";

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
  translateToChinese: z.boolean().optional(),
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
    const shouldTranslateToChinese = data.translateToChinese ?? true;

    try {
      const segments = await db
        .select({
          id: transcriptSegments.id,
          polishedText: transcriptSegments.polishedText,
          text: transcriptSegments.text,
          translatedText: transcriptSegments.translatedText,
        })
        .from(transcriptSegments)
        .where(
          and(
            eq(transcriptSegments.meetingId, data.meetingId),
            eq(
              transcriptSegments.jobId,
              currentTranscriptJobIdSubquery(data.meetingId),
            ),
          ),
        )
        .orderBy(asc(transcriptSegments.startMs));
      const unpolishedSegments = segments
        .filter((segment) => !segment.polishedText?.trim())
        .map((segment) => ({
          id: segment.id,
          text: segment.text,
        }));
      let newPolishedCount = 0;
      const polishedTextById = new Map<string, string>();

      for (
        let index = 0;
        index < unpolishedSegments.length;
        index += TRANSLATION_BATCH_SIZE
      ) {
        const batch = unpolishedSegments.slice(
          index,
          index + TRANSLATION_BATCH_SIZE,
        );
        const polishedSegments =
          await polishTranscriptSegmentsInOriginalLanguage(batch, {
            batchSize: TRANSLATION_BATCH_SIZE,
          });

        for (const polishedSegment of polishedSegments) {
          await db
            .update(transcriptSegments)
            .set({
              polishedText: polishedSegment.text,
              updatedAt: new Date(),
            })
            .where(eq(transcriptSegments.id, polishedSegment.id));
          polishedTextById.set(polishedSegment.id, polishedSegment.text);
        }

        newPolishedCount += polishedSegments.length;
      }

      const polishedCount =
        segments.length - unpolishedSegments.length + newPolishedCount;

      if (polishedCount < segments.length) {
        throw new Error(
          `Original polish incomplete: ${polishedCount} of ${segments.length} lines polished`,
        );
      }

      if (!shouldTranslateToChinese) {
        return { polishedCount: newPolishedCount, translatedCount: 0 };
      }

      await markMeetingTranslationRunning(data.meetingId);

      const untranslatedSegments = segments
        .filter((segment) => !segment.translatedText?.trim())
        .map((segment) => ({
          id: segment.id,
          text:
            polishedTextById.get(segment.id) ??
            segment.polishedText?.trim() ??
            segment.text,
        }));
      let newTranslatedCount = 0;

      for (
        let index = 0;
        index < untranslatedSegments.length;
        index += TRANSLATION_BATCH_SIZE
      ) {
        const batch = untranslatedSegments.slice(
          index,
          index + TRANSLATION_BATCH_SIZE,
        );
        const translations = await translateTranscriptSegmentsToChinese(batch, {
          batchSize: TRANSLATION_BATCH_SIZE,
        });

        for (const translation of translations) {
          await db
            .update(transcriptSegments)
            .set({
              translatedText: translation.text,
              updatedAt: new Date(),
            })
            .where(eq(transcriptSegments.id, translation.id));
        }

        newTranslatedCount += translations.length;
      }

      const translatedCount =
        segments.length - untranslatedSegments.length + newTranslatedCount;

      if (translatedCount < segments.length) {
        throw new Error(
          `Translation incomplete: ${translatedCount} of ${segments.length} lines translated`,
        );
      }

      await markMeetingTranslationCompleted(data.meetingId);

      return { translatedCount: newTranslatedCount };
    } catch (error) {
      if (shouldTranslateToChinese) {
        await markMeetingTranslationFailed(data.meetingId, error);
      }
      throw error;
    }
  },
);

export const sendLocationReminders = inngest.createFunction(
  {
    id: "send-location-reminders",
    triggers: [{ event: "meeting/send.location-reminders" }],
  },
  async () => sendDueLocationReminders(),
);

export const syncRecallCalendarsHourly = inngest.createFunction(
  {
    id: "sync-recall-calendars-hourly",
    triggers: [{ cron: "0 * * * *" }],
  },
  async () => syncRecallCalendarEventsForAllConnectedUsers(),
);

export const functions = [
  scheduleMeetingBot,
  transcribeAudio,
  enrichTranscript,
  sendLocationReminders,
  syncRecallCalendarsHourly,
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
