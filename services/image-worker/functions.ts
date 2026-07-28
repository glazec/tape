import { z } from "zod";

import { persistRecallMeetingVideoFrames } from "@/lib/meeting-video-frames";
import {
  cleanupCompletedTranscriptChunks,
  type CompletedTranscriptChunk,
  markChunkedTranscriptJobFailed,
  persistCompletedTranscriptChunks,
  prepareTranscriptAudioChunks,
  queueChunkedTranscriptEnrichment,
  transcribePreparedTranscriptChunk,
} from "@/lib/transcript-chunk-worker";
import { imageWorkerInngest } from "@/services/image-worker/client";

const extractionDataSchema = z.object({
  meetingId: z.uuid(),
  recallBotId: z.string().trim().min(1).optional(),
  recallRecordingId: z.string().trim().min(1),
});
const chunkedTranscriptionDataSchema = z
  .object({
    audioUrl: z.url().optional(),
    keyterms: z.array(z.string().trim().min(1)).default([]),
    meetingId: z.uuid(),
    objectKey: z.string().trim().min(1).optional(),
    recordingId: z.uuid().optional(),
    transcriptJobId: z.uuid(),
  })
  .refine((value) => Boolean(value.audioUrl || value.objectKey), {
    message: "Transcript media is required",
  });

export const extractMeetingVideoFrames = imageWorkerInngest.createFunction(
  {
    concurrency: 1,
    id: "extract-meeting-video-frames",
    retries: 2,
    triggers: [{ event: "meeting/extract.video-frames" }],
  },
  async ({ event }) => {
    const data = extractionDataSchema.parse(event.data);

    return persistRecallMeetingVideoFrames(data);
  },
);

const CHUNKED_TRANSCRIPTION_RETRIES = 2;

export const transcribeMeetingInChunks = imageWorkerInngest.createFunction(
  {
    concurrency: 1,
    id: "transcribe-meeting-in-chunks",
    retries: CHUNKED_TRANSCRIPTION_RETRIES,
    triggers: [{ event: "meeting/transcribe.audio-in-chunks" }],
  },
  async ({ event, step, attempt = 0 }) => {
    const data = chunkedTranscriptionDataSchema.parse(event.data);

    try {
      const chunks = await step.run("prepare-audio-chunks", () =>
        prepareTranscriptAudioChunks(data),
      );
      const completedChunks: CompletedTranscriptChunk[] = [];

      for (const chunk of chunks) {
        completedChunks.push(
          await step.run(`transcribe-audio-chunk-${chunk.plan.index}`, () =>
            transcribePreparedTranscriptChunk({
              chunk,
              keyterms: data.keyterms,
              meetingId: data.meetingId,
              transcriptJobId: data.transcriptJobId,
            }),
          ),
        );
      }

      const result = await step.run("persist-chunked-transcript", () =>
        persistCompletedTranscriptChunks({
          chunks: completedChunks,
          meetingId: data.meetingId,
          ...(data.recordingId ? { recordingId: data.recordingId } : {}),
          transcriptJobId: data.transcriptJobId,
        }),
      );

      await step.run("queue-chunked-transcript-enrichment", () =>
        queueChunkedTranscriptEnrichment({
          meetingId: data.meetingId,
          translateTranscript: result.translateTranscript,
          translationLanguage: result.translationLanguage,
        }),
      );
      await step.run("cleanup-transcript-chunks", () =>
        cleanupCompletedTranscriptChunks(completedChunks),
      );

      return result;
    } catch (error) {
      if (attempt >= CHUNKED_TRANSCRIPTION_RETRIES) {
        await markChunkedTranscriptJobFailed({
          error,
          meetingId: data.meetingId,
          transcriptJobId: data.transcriptJobId,
        });
      }

      throw error;
    }
  },
);

export const functions = [
  extractMeetingVideoFrames,
  transcribeMeetingInChunks,
];
