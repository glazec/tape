import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { transcriptJobs, transcriptSegments } from "@/db/schema";
import { inngest } from "./client";
import { currentTranscriptJobIdSubquery } from "@/lib/current-transcript-job";
import { convertVideoObjectToAudio } from "@/lib/media-conversion";
import { createReadUrl } from "@/lib/r2";
import { sendDueLocationReminders } from "@/lib/location-reminders";
import { getMeetingVocabularyKeyterms } from "@/lib/team-vocabulary";
import { completeUploadedVideoConversion } from "@/lib/transcription-records";
import { createElevenLabsTranscriptJob } from "@/lib/vendors/elevenlabs";
import {
  getStoredMeetingTranslationLanguage,
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationRunning,
} from "@/lib/meeting-translation-jobs";
import {
  polishTranscriptSegmentsInOriginalLanguage,
  TRANSLATION_BATCH_SIZE,
  translateTranscriptSegments,
} from "@/lib/vendors/openrouter";
import {
  DEFAULT_TRANSLATION_LANGUAGE,
  translationLanguageSchema,
} from "@/lib/meeting-translation-language";
import { scheduleRecallBot } from "@/lib/vendors/recall";
import { syncRecallCalendarEventsForAllConnectedUsers } from "@/lib/recall-calendar-bulk-sync";
import { reconcileStaleMeetingJobs } from "@/lib/stale-meeting-jobs";

const appUrlSchema = z.string().trim().url();

const scheduleMeetingBotDataSchema = z.object({
  meetingUrl: z.url(),
  startAt: z.iso.datetime().optional(),
});

const transcribeAudioDataSchema = z.union([
  z.object({
    audioUrl: z.url(),
    meetingId: z.uuid().optional(),
    mediaAssetId: z.uuid().optional(),
    recordingId: z.uuid().optional(),
    transcriptJobId: z.uuid().optional(),
  }),
  z.object({
    objectKey: z.string().min(1),
    meetingId: z.uuid().optional(),
    mediaAssetId: z.uuid().optional(),
    recordingId: z.uuid().optional(),
    transcriptJobId: z.uuid().optional(),
  }),
]);
const TRANSCRIBE_AUDIO_RETRIES = 4;

const convertVideoToAudioDataSchema = z.object({
  meetingId: z.uuid(),
  sourceMediaAssetId: z.uuid(),
  sourceObjectKey: z.string().min(1),
  audioMediaAssetId: z.uuid(),
  audioObjectKey: z.string().min(1),
  recordingId: z.uuid().optional(),
  transcriptJobId: z.uuid(),
});
const CONVERT_VIDEO_TO_AUDIO_RETRIES = 2;

const enrichTranscriptDataSchema = z.object({
  meetingId: z.uuid(),
  translateTranscript: z.boolean().optional(),
  translationLanguage: translationLanguageSchema.optional(),
  translateToChinese: z.boolean().optional(),
});
const ENRICH_TRANSCRIPT_RETRIES = 4;

function getAppUrl() {
  return appUrlSchema.parse(process.env.NEXT_PUBLIC_APP_URL);
}

const scheduleMeetingBot = inngest.createFunction(
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
  {
    id: "transcribe-audio",
    retries: TRANSCRIBE_AUDIO_RETRIES,
    triggers: [{ event: "meeting/transcribe.audio" }],
  },
  async ({ event, attempt = 0 }) => {
    const data = transcribeAudioDataSchema.parse(event.data);

    try {
      const appUrl = getAppUrl();
      const audioUrl =
        "audioUrl" in data
          ? data.audioUrl
          : await createReadUrl({ key: data.objectKey });
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
    } catch (error) {
      await markTranscriptJobFailedAfterFinalAttempt({
        attempt,
        error,
        maxAttempts: TRANSCRIBE_AUDIO_RETRIES,
        transcriptJobId: data.transcriptJobId,
      });
      throw error;
    }
  },
);

export const convertVideoToAudio = inngest.createFunction(
  {
    id: "convert-video-to-audio",
    retries: CONVERT_VIDEO_TO_AUDIO_RETRIES,
    triggers: [{ event: "meeting/convert.video-to-audio" }],
  },
  async ({ event, step, attempt = 0 }) => {
    const data = convertVideoToAudioDataSchema.parse(event.data);

    try {
      await convertVideoObjectToAudio({
        sourceObjectKey: data.sourceObjectKey,
        audioObjectKey: data.audioObjectKey,
      });

      const transcription = await completeUploadedVideoConversion({
        meetingId: data.meetingId,
        audioMediaAssetId: data.audioMediaAssetId,
        audioObjectKey: data.audioObjectKey,
        recordingId: data.recordingId,
        transcriptJobId: data.transcriptJobId,
      });

      return step.sendEvent("queue-audio-transcription", {
        name: "meeting/transcribe.audio",
        data: transcription,
      });
    } catch (error) {
      await markTranscriptJobFailedAfterFinalAttempt({
        attempt,
        error,
        maxAttempts: CONVERT_VIDEO_TO_AUDIO_RETRIES,
        transcriptJobId: data.transcriptJobId,
      });
      throw error;
    }
  },
);

export const enrichTranscript = inngest.createFunction(
  {
    id: "enrich-transcript",
    retries: ENRICH_TRANSCRIPT_RETRIES,
    triggers: [{ event: "meeting/enrich.transcript" }],
  },
  async ({ event, attempt = 0 }) => {
    const data = enrichTranscriptDataSchema.parse(event.data);
    const shouldTranslate =
      data.translateTranscript ?? data.translateToChinese ?? true;
    const translationLanguage =
      data.translationLanguage ?? DEFAULT_TRANSLATION_LANGUAGE;
    let translationFinished = !shouldTranslate;

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
      let newTranslatedCount = 0;

      if (shouldTranslate) {
        const storedTranslationLanguage =
          await getStoredMeetingTranslationLanguage(data.meetingId);
        const targetLanguageChanged =
          storedTranslationLanguage !== translationLanguage;

        if (targetLanguageChanged) {
          await db
            .update(transcriptSegments)
            .set({ translatedText: null, updatedAt: new Date() })
            .where(
              and(
                eq(transcriptSegments.meetingId, data.meetingId),
                eq(
                  transcriptSegments.jobId,
                  currentTranscriptJobIdSubquery(data.meetingId),
                ),
              ),
            );
        }

        const untranslatedSegments = segments
          .filter(
            (segment) =>
              targetLanguageChanged || !segment.translatedText?.trim(),
          )
          .map((segment) => ({
            id: segment.id,
            text: segment.text,
          }));

        if (untranslatedSegments.length > 0) {
          await markMeetingTranslationRunning(
            data.meetingId,
            translationLanguage,
          );
        }

        for (
          let index = 0;
          index < untranslatedSegments.length;
          index += TRANSLATION_BATCH_SIZE
        ) {
          const batch = untranslatedSegments.slice(
            index,
            index + TRANSLATION_BATCH_SIZE,
          );
          const translations = await translateTranscriptSegments(
            batch,
            {
              batchSize: TRANSLATION_BATCH_SIZE,
              onTranslated: async (translatedRows) => {
                for (const translation of translatedRows) {
                  await db
                    .update(transcriptSegments)
                    .set({
                      translatedText: translation.text,
                      updatedAt: new Date(),
                    })
                    .where(eq(transcriptSegments.id, translation.id));
                }
              },
              targetLanguage: translationLanguage,
            },
          );

          newTranslatedCount += translations.length;
        }

        const translatedCount =
          segments.length - untranslatedSegments.length + newTranslatedCount;

        if (translatedCount < segments.length) {
          throw new Error(
            `Translation incomplete: ${translatedCount} of ${segments.length} lines translated`,
          );
        }

        translationFinished = true;
        await markMeetingTranslationCompleted(
          data.meetingId,
          translationLanguage,
        );
      }

      const unpolishedSegments = segments
        .filter((segment) => !segment.polishedText?.trim())
        .map((segment) => ({
          id: segment.id,
          text: segment.text,
        }));
      let newPolishedCount = 0;

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

      return {
        polishedCount: newPolishedCount,
        translatedCount: newTranslatedCount,
      };
    } catch (error) {
      if (
        shouldTranslate &&
        !translationFinished &&
        attempt >= ENRICH_TRANSCRIPT_RETRIES
      ) {
        await markMeetingTranslationFailed(data.meetingId, error);
      }
      throw error;
    }
  },
);

const sendLocationReminders = inngest.createFunction(
  {
    id: "send-location-reminders",
    triggers: [
      { event: "meeting/send.location-reminders" },
      { cron: "* * * * *" },
    ],
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

const reconcileStaleJobs = inngest.createFunction(
  {
    id: "reconcile-stale-meeting-jobs",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async () => reconcileStaleMeetingJobs(),
);

export const functions = [
  scheduleMeetingBot,
  transcribeAudio,
  convertVideoToAudio,
  enrichTranscript,
  sendLocationReminders,
  syncRecallCalendarsHourly,
  reconcileStaleJobs,
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

  if (data.recordingId) {
    metadata.recordingId = data.recordingId;
  }

  if (data.transcriptJobId) {
    metadata.transcriptJobId = data.transcriptJobId;
  }

  return metadata;
}

async function markTranscriptJobFailedAfterFinalAttempt(input: {
  attempt: number;
  error: unknown;
  maxAttempts: number;
  transcriptJobId?: string;
}) {
  if (
    !input.transcriptJobId ||
    input.attempt < input.maxAttempts
  ) {
    return;
  }

  await db
    .update(transcriptJobs)
    .set({
      errorMessage: getErrorMessage(input.error),
      status: "failed",
      updatedAt: new Date(),
    })
    .where(eq(transcriptJobs.id, input.transcriptJobId));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Transcription failed";
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
