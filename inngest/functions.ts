import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { transcriptJobs, transcriptSegments } from "@/db/schema";
import { inngest } from "./client";
import { currentTranscriptJobIdsSubquery } from "@/lib/current-transcript-job";
import { convertVideoObjectToAudio } from "@/lib/media-conversion";
import { createReadUrl } from "@/lib/r2";
import {
  dispatchPendingLocationReminderSchedules,
  markLocationReminderDeliveryFailed,
  sendScheduledLocationReminder,
} from "@/lib/location-reminders";
import { getMeetingVocabularyKeyterms } from "@/lib/team-vocabulary";
import {
  shouldChunkTranscription,
} from "@/lib/transcript-chunking";
import { getTranscriptJobDurationMs } from "@/lib/transcription-duration";
import { completeUploadedVideoConversion } from "@/lib/transcription-records";
import { createElevenLabsTranscriptJob } from "@/lib/vendors/elevenlabs";
import {
  getStoredMeetingTranslationLanguage,
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationFailedIfActive,
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
import {
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  scheduleRecallBot,
} from "@/lib/vendors/recall";
import { syncRecallCalendarEventsForAllConnectedUsers } from "@/lib/recall-calendar-bulk-sync";
import { reconcileStaleMeetingJobs } from "@/lib/stale-meeting-jobs";
import { stopBotsForExhaustedWorkspaces } from "@/lib/provider-credit-enforcement";
import { dispatchQueuedUploadTranscriptions } from "@/lib/upload-transcription-dispatch";
import {
  assertMeetingHasProviderCredit,
  assertWorkspaceHasProviderCredit,
  ProviderCreditExhaustedError,
} from "@/lib/provider-credit";
import {
  markEmptyTranscriptRecoveryFailed,
  prepareEmptyTranscriptRecovery,
} from "@/lib/empty-transcript-recovery";

const appUrlSchema = z.string().trim().url();

const scheduleMeetingBotDataSchema = z.object({
  meetingUrl: z.url(),
  startAt: z.iso.datetime().optional(),
  teamId: z.uuid(),
});
const deleteRecallBotDataSchema = z.object({
  botId: z.string().trim().min(1),
});
const deleteRecallCalendarEventBotDataSchema = z.object({
  calendarEventId: z.string().trim().min(1),
});

const transcribeAudioDataSchema = z.union([
  z.object({
    audioUrl: z.url(),
    meetingId: z.uuid(),
    mediaAssetId: z.uuid().optional(),
    recordingId: z.uuid().optional(),
    transcriptJobId: z.uuid().optional(),
  }),
  z.object({
    objectKey: z.string().min(1),
    meetingId: z.uuid(),
    mediaAssetId: z.uuid().optional(),
    recordingId: z.uuid().optional(),
    transcriptJobId: z.uuid().optional(),
  }),
]);
const TRANSCRIBE_AUDIO_RETRIES = 4;
const EMPTY_TRANSCRIPT_RECOVERY_RETRIES = 4;
const emptyTranscriptRecoveryDataSchema = z.object({
  meetingId: z.uuid(),
  objectKey: z.string().trim().min(1).optional(),
  recordingId: z.uuid().optional(),
  transcriptJobId: z.uuid(),
});

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
const SEND_LOCATION_REMINDER_RETRIES = 4;
const locationReminderDataSchema = z.object({
  reminderId: z.uuid(),
  scheduleVersion: z.number().int().positive(),
  scheduledFor: z.iso.datetime(),
});

function getAppUrl() {
  return appUrlSchema.parse(process.env.NEXT_PUBLIC_APP_URL);
}

export const scheduleMeetingBot = inngest.createFunction(
  { id: "schedule-meeting-bot", triggers: [{ event: "meeting/schedule.bot" }] },
  async ({ event }) => {
    const data = scheduleMeetingBotDataSchema.parse(event.data);
    const appUrl = getAppUrl();
    await assertWorkspaceHasProviderCredit(data.teamId);

    return scheduleRecallBot({
      meetingUrl: data.meetingUrl,
      startAt: data.startAt,
      webhookUrl: `${appUrl}/api/recall/webhook`,
    });
  },
);

export const deleteRecallBot = inngest.createFunction(
  {
    id: "delete-recall-bot",
    retries: 4,
    triggers: [{ event: "meeting/delete.recall-bot" }],
  },
  async ({ event }) => {
    const data = deleteRecallBotDataSchema.parse(event.data);

    return deleteScheduledRecallBot({ botId: data.botId });
  },
);

export const deleteRecallCalendarEventBotJob = inngest.createFunction(
  {
    id: "delete-recall-calendar-event-bot",
    retries: 4,
    triggers: [{ event: "meeting/delete.recall-calendar-event-bot" }],
  },
  async ({ event }) => {
    const data = deleteRecallCalendarEventBotDataSchema.parse(event.data);

    return deleteRecallCalendarEventBot({
      calendarEventId: data.calendarEventId,
    });
  },
);

export const transcribeAudio = inngest.createFunction(
  {
    id: "transcribe-audio",
    retries: TRANSCRIBE_AUDIO_RETRIES,
    triggers: [{ event: "meeting/transcribe.audio" }],
  },
  async ({ event, step, attempt = 0 }) => {
    const data = transcribeAudioDataSchema.parse(event.data);

    try {
      await assertMeetingHasProviderCredit(data.meetingId);

      const keyterms = await getMeetingVocabularyKeyterms(data.meetingId);
      const durationMs = data.transcriptJobId
        ? await getTranscriptJobDurationMs(data.transcriptJobId)
        : null;

      if (
        data.transcriptJobId &&
        shouldChunkTranscription(durationMs)
      ) {
        await db
          .update(transcriptJobs)
          .set({
            billingKeytermsUsed: keyterms.length > 0,
            status: "running",
            updatedAt: new Date(),
          })
          .where(eq(transcriptJobs.id, data.transcriptJobId));

        return step.sendEvent("queue-chunked-transcription", {
          id: `chunked-transcription:${data.transcriptJobId}`,
          name: "meeting/transcribe.audio-in-chunks",
          data: {
            ...data,
            keyterms,
          },
        });
      }

      const appUrl = getAppUrl();
      const audioUrl =
        "audioUrl" in data
          ? data.audioUrl
          : await createReadUrl({ key: data.objectKey });

      const response = await step.run(
        "create-elevenlabs-transcript-job",
        () =>
          createElevenLabsTranscriptJob({
            audioUrl,
            webhookUrl: `${appUrl}/api/elevenlabs/webhook`,
            keyterms,
            metadata: buildTranscriptMetadata(data),
          }),
      );

      const providerJobId = getProviderJobId(response);

      if (data.transcriptJobId) {
        await db
          .update(transcriptJobs)
          .set({
            billingKeytermsUsed: keyterms.length > 0,
            providerJobId,
            status: providerJobId ? "running" : "queued",
            updatedAt: new Date(),
          })
          .where(eq(transcriptJobs.id, data.transcriptJobId));
      }

      return response;
    } catch (error) {
      if (error instanceof ProviderCreditExhaustedError) {
        if (data.transcriptJobId) {
          await markTranscriptJobCreditExhausted(data.transcriptJobId, error);
        }

        return { action: "skipped", reason: "credit_exhausted" };
      }

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

export const recoverEmptyTranscript = inngest.createFunction(
  {
    id: "recover-empty-transcript",
    retries: EMPTY_TRANSCRIPT_RECOVERY_RETRIES,
    triggers: [{ event: "meeting/recover.empty-transcript" }],
  },
  async ({ event, step, attempt = 0 }) => {
    const data = emptyTranscriptRecoveryDataSchema.parse(event.data);

    try {
      const recovery = await step.run(
        "prepare-empty-transcript-recovery",
        () => prepareEmptyTranscriptRecovery(data),
      );

      return step.sendEvent("queue-empty-transcript-chunked-recovery", {
        id: `empty-transcript-chunked:${data.transcriptJobId}`,
        name: "meeting/transcribe.audio-in-chunks",
        data: recovery,
      });
    } catch (error) {
      if (attempt >= EMPTY_TRANSCRIPT_RECOVERY_RETRIES) {
        await markEmptyTranscriptRecoveryFailed({
          error,
          meetingId: data.meetingId,
          transcriptJobId: data.transcriptJobId,
        });
      }

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
        id: `upload-transcription:${data.transcriptJobId}`,
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
    onFailure: async ({ event, error }) => {
      const data = enrichTranscriptDataSchema.parse(event.data.event.data);
      const shouldTranslate =
        data.translateTranscript ?? data.translateToChinese ?? true;

      if (shouldTranslate) {
        await markMeetingTranslationFailedIfActive(data.meetingId, error);
      }
    },
    retries: ENRICH_TRANSCRIPT_RETRIES,
    triggers: [{ event: "meeting/enrich.transcript" }],
  },
  async ({ event, step }) => {
    const data = enrichTranscriptDataSchema.parse(event.data);
    const shouldTranslate =
      data.translateTranscript ?? data.translateToChinese ?? true;
    const translationLanguage =
      data.translationLanguage ?? DEFAULT_TRANSLATION_LANGUAGE;
    try {
      await assertMeetingHasProviderCredit(data.meetingId);

      const segments = await db
        .select({
          id: transcriptSegments.id,
          text: transcriptSegments.text,
        })
        .from(transcriptSegments)
        .where(
          and(
            eq(transcriptSegments.meetingId, data.meetingId),
            inArray(
              transcriptSegments.jobId,
              currentTranscriptJobIdsSubquery(data.meetingId),
            ),
          ),
        )
        .orderBy(
          asc(transcriptSegments.startMs),
          asc(transcriptSegments.endMs),
          asc(transcriptSegments.id),
        );
      let newTranslatedCount = 0;

      if (shouldTranslate) {
        await step.run("prepare-transcript-translation", async () => {
          const storedTranslationLanguage =
            await getStoredMeetingTranslationLanguage(data.meetingId);

          if (storedTranslationLanguage !== translationLanguage) {
            await db
              .update(transcriptSegments)
              .set({ translatedText: null, updatedAt: new Date() })
              .where(
                and(
                  eq(transcriptSegments.meetingId, data.meetingId),
                  inArray(
                    transcriptSegments.jobId,
                    currentTranscriptJobIdsSubquery(data.meetingId),
                  ),
                ),
              );
          }

          const currentSegments = await db
            .select({
              translatedText: transcriptSegments.translatedText,
            })
            .from(transcriptSegments)
            .where(
              and(
                eq(transcriptSegments.meetingId, data.meetingId),
                inArray(
                  transcriptSegments.jobId,
                  currentTranscriptJobIdsSubquery(data.meetingId),
                ),
              ),
            );

          if (
            currentSegments.some(
              (segment) => !segment.translatedText?.trim(),
            )
          ) {
            await markMeetingTranslationRunning(
              data.meetingId,
              translationLanguage,
            );
          }
        });

        for (
          let index = 0;
          index < segments.length;
          index += TRANSLATION_BATCH_SIZE
        ) {
          const batch = segments.slice(
            index,
            index + TRANSLATION_BATCH_SIZE,
          );
          const batchNumber = index / TRANSLATION_BATCH_SIZE;

          newTranslatedCount += await step.run(
            `translate-transcript-batch-${batchNumber}`,
            async () => {
              const currentSegments = await db
                .select({
                  id: transcriptSegments.id,
                  translatedText: transcriptSegments.translatedText,
                })
                .from(transcriptSegments)
                .where(
                  and(
                    eq(transcriptSegments.meetingId, data.meetingId),
                    inArray(
                      transcriptSegments.jobId,
                      currentTranscriptJobIdsSubquery(data.meetingId),
                    ),
                    inArray(
                      transcriptSegments.id,
                      batch.map((segment) => segment.id),
                    ),
                  ),
                );
              const translatedById = new Map(
                currentSegments.map((segment) => [
                  segment.id,
                  segment.translatedText,
                ]),
              );
              const pendingSegments = batch.filter(
                (segment) => !translatedById.get(segment.id)?.trim(),
              );

              if (pendingSegments.length === 0) {
                return 0;
              }

              const translations = await translateTranscriptSegments(
                pendingSegments,
                {
                  batchSize: TRANSLATION_BATCH_SIZE,
                  meetingId: data.meetingId,
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

              return translations.length;
            },
          );
        }

        await step.run(
          "complete-transcript-translation",
          async () => {
            const currentSegments = await db
              .select({
                translatedText: transcriptSegments.translatedText,
              })
              .from(transcriptSegments)
              .where(
                and(
                  eq(transcriptSegments.meetingId, data.meetingId),
                  inArray(
                    transcriptSegments.jobId,
                    currentTranscriptJobIdsSubquery(data.meetingId),
                  ),
                ),
              );
            const completedCount = currentSegments.filter((segment) =>
              segment.translatedText?.trim(),
            ).length;

            if (completedCount < segments.length) {
              throw new Error(
                `Translation incomplete: ${completedCount} of ${segments.length} lines translated`,
              );
            }

            await markMeetingTranslationCompleted(
              data.meetingId,
              translationLanguage,
            );
            return completedCount;
          },
        );
      }

      let newPolishedCount = 0;

      for (
        let index = 0;
        index < segments.length;
        index += TRANSLATION_BATCH_SIZE
      ) {
        const batch = segments.slice(
          index,
          index + TRANSLATION_BATCH_SIZE,
        );
        const batchNumber = index / TRANSLATION_BATCH_SIZE;

        newPolishedCount += await step.run(
          `polish-transcript-batch-${batchNumber}`,
          async () => {
            const currentSegments = await db
              .select({
                id: transcriptSegments.id,
                polishedText: transcriptSegments.polishedText,
              })
              .from(transcriptSegments)
              .where(
                and(
                  eq(transcriptSegments.meetingId, data.meetingId),
                  inArray(
                    transcriptSegments.jobId,
                    currentTranscriptJobIdsSubquery(data.meetingId),
                  ),
                  inArray(
                    transcriptSegments.id,
                    batch.map((segment) => segment.id),
                  ),
                ),
              );
            const polishedById = new Map(
              currentSegments.map((segment) => [
                segment.id,
                segment.polishedText,
              ]),
            );
            const pendingSegments = batch.filter(
              (segment) => !polishedById.get(segment.id)?.trim(),
            );

            if (pendingSegments.length === 0) {
              return 0;
            }

            const polishedSegments =
              await polishTranscriptSegmentsInOriginalLanguage(
                pendingSegments,
                {
                  batchSize: TRANSLATION_BATCH_SIZE,
                  meetingId: data.meetingId,
                },
              );

            for (const polishedSegment of polishedSegments) {
              await db
                .update(transcriptSegments)
                .set({
                  polishedText: polishedSegment.text,
                  updatedAt: new Date(),
                })
                .where(eq(transcriptSegments.id, polishedSegment.id));
            }

            return polishedSegments.length;
          },
        );
      }

      await step.run("complete-transcript-polish", async () => {
        const currentSegments = await db
          .select({
            polishedText: transcriptSegments.polishedText,
          })
          .from(transcriptSegments)
          .where(
            and(
              eq(transcriptSegments.meetingId, data.meetingId),
              inArray(
                transcriptSegments.jobId,
                currentTranscriptJobIdsSubquery(data.meetingId),
              ),
            ),
          );
        const polishedCount = currentSegments.filter((segment) =>
          segment.polishedText?.trim(),
        ).length;

        if (polishedCount < segments.length) {
          throw new Error(
            `Original polish incomplete: ${polishedCount} of ${segments.length} lines polished`,
          );
        }

        return polishedCount;
      });

      return {
        polishedCount: newPolishedCount,
        translatedCount: newTranslatedCount,
      };
    } catch (error) {
      if (error instanceof ProviderCreditExhaustedError) {
        if (shouldTranslate) {
          await markMeetingTranslationFailed(data.meetingId, error);
        }

        return { action: "skipped", reason: "credit_exhausted" };
      }

      throw error;
    }
  },
);

export const sendLocationReminder = inngest.createFunction(
  {
    id: "send-location-reminder",
    retries: SEND_LOCATION_REMINDER_RETRIES,
    triggers: [{ event: "meeting/send.location-reminder" }],
  },
  async ({ event, step, attempt = 0 }) => {
    const data = locationReminderDataSchema.parse(event.data);

    await step.sleepUntil(
      "wait-for-location-reminder",
      new Date(data.scheduledFor),
    );

    try {
      return await step.run("deliver-location-reminder", () =>
        sendScheduledLocationReminder(data),
      );
    } catch (error) {
      if (attempt >= SEND_LOCATION_REMINDER_RETRIES) {
        await markLocationReminderDeliveryFailed({
          error,
          reminderId: data.reminderId,
          scheduleVersion: data.scheduleVersion,
        });
      }
      throw error;
    }
  },
);

export const reconcileLocationReminderSchedules = inngest.createFunction(
  {
    id: "reconcile-location-reminder-schedules",
    triggers: [
      { event: "meeting/reconcile.location-reminder-schedules" },
      { cron: "5 * * * *" },
    ],
  },
  async () => dispatchPendingLocationReminderSchedules(),
);

export const syncRecallCalendarsHourly = inngest.createFunction(
  {
    id: "sync-recall-calendars-hourly",
    triggers: [{ cron: "0 * * * *" }],
  },
  async () => syncRecallCalendarEventsForAllConnectedUsers(),
);

export const enforceProviderCredit = inngest.createFunction(
  {
    id: "enforce-provider-credit",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async () => stopBotsForExhaustedWorkspaces(),
);

const reconcileStaleJobs = inngest.createFunction(
  {
    id: "reconcile-stale-meeting-jobs",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async () => {
    const dispatch = await dispatchQueuedUploadTranscriptions();
    const reconciliation = await reconcileStaleMeetingJobs();

    return { ...dispatch, ...reconciliation };
  },
);

export const functions = [
  scheduleMeetingBot,
  deleteRecallBot,
  deleteRecallCalendarEventBotJob,
  transcribeAudio,
  recoverEmptyTranscript,
  convertVideoToAudio,
  enrichTranscript,
  sendLocationReminder,
  reconcileLocationReminderSchedules,
  syncRecallCalendarsHourly,
  enforceProviderCredit,
  reconcileStaleJobs,
];

function buildTranscriptMetadata(
  data: z.infer<typeof transcribeAudioDataSchema>,
) {
  const metadata: Record<string, string> = {};

  if ("objectKey" in data) {
    metadata.objectKey = data.objectKey;
  }

  metadata.meetingId = data.meetingId;

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
  if (!input.transcriptJobId || input.attempt < input.maxAttempts) {
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

async function markTranscriptJobCreditExhausted(
  transcriptJobId: string,
  error: ProviderCreditExhaustedError,
) {
  await db
    .update(transcriptJobs)
    .set({
      errorMessage: error.message,
      status: "failed",
      updatedAt: new Date(),
    })
    .where(eq(transcriptJobs.id, transcriptJobId));
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
