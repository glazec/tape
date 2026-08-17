import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, transcriptJobs } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { getActiveTranscriptText } from "@/lib/active-transcript-text";
import {
  applyElevenLabsTranscriptEvent,
  finalizeMeetingTranscriptGeneration,
} from "@/lib/elevenlabs-transcripts";
import {
  markMeetingTranslationCompleted,
  markMeetingTranslationQueued,
} from "@/lib/meeting-translation-jobs";
import { shouldAutoTranslateTranscript } from "@/lib/meeting-translation-language";
import {
  mergeElevenLabsChunkTranscripts,
  planTranscriptChunks,
  type ElevenLabsChunkTranscript,
  type TranscriptChunkPlan,
} from "@/lib/transcript-chunking";
import { getMeetingTranslationLanguage } from "@/lib/team-configuration";
import {
  buildMeetingObjectKey,
  createReadUrl,
  deleteObject,
  putObject,
} from "@/lib/r2";
import {
  createProcessRunner,
  type ProcessRunner,
} from "@/lib/video-frame-ffmpeg";
import {
  normalizeElevenLabsWebhook,
  transcribeElevenLabsAudioFile,
} from "@/lib/vendors/elevenlabs";

type ChunkedTranscriptInput = {
  audioUrl?: string;
  keyterms: string[];
  meetingId: string;
  objectKey?: string;
  recordingId?: string;
  transcriptJobId: string;
};

export type PreparedTranscriptChunk = {
  audioObjectKey: string;
  plan: TranscriptChunkPlan;
};

export type CompletedTranscriptChunk = PreparedTranscriptChunk & {
  transcriptObjectKey: string;
  transcriptionId: string | null;
};

type TranscriptChunkWorkerDependencies = {
  createReadUrl: typeof createReadUrl;
  ffmpegPath: string;
  ffprobePath: string;
  putObject: typeof putObject;
  runProcess: ProcessRunner;
};

const TRANSCRIPT_CHUNK_MAX_BYTES = 64 * 1024 * 1024;
const TRANSCRIPT_RESULT_MAX_BYTES = 16 * 1024 * 1024;
const MEDIA_PROCESS_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const TRUSTED_RECALL_MEDIA_HOSTS = new Set([
  "recallai-production-bot-data.s3.amazonaws.com",
  "ap-northeast-1-recallai-production-bot-data.s3.amazonaws.com",
]);

export function createTranscriptChunkWorkerAdapter(
  dependencies: TranscriptChunkWorkerDependencies,
) {
  async function prepareTranscriptAudioChunks(
    input: ChunkedTranscriptInput,
  ): Promise<PreparedTranscriptChunk[]> {
    const [meeting] = await db
      .select({ teamId: meetings.teamId })
      .from(meetings)
      .where(eq(meetings.id, input.meetingId))
      .limit(1);

    if (!meeting) {
      throw new Error("Meeting not found");
    }

    const sourceUrl = input.objectKey
      ? await dependencies.createReadUrl({ key: input.objectKey })
      : input.audioUrl;

    if (!sourceUrl) {
      throw new Error("Transcript media is unavailable");
    }

    const safeSourceUrl = parseTranscriptMediaUrl(sourceUrl);
    const durationMs = await probeMediaDurationMs(safeSourceUrl, dependencies);
    const plans = planTranscriptChunks(durationMs);
    const chunks: PreparedTranscriptChunk[] = [];

    for (const plan of plans) {
      const audio = await extractAudioChunk(safeSourceUrl, plan, dependencies);
      const audioObjectKey = buildMeetingObjectKey({
        teamId: meeting.teamId,
        meetingId: input.meetingId,
        assetId: `${input.transcriptJobId}-transcript-chunk-${plan.index}`,
        extension: "mp3",
      });

      await dependencies.putObject({
        key: audioObjectKey,
        body: audio,
        contentType: "audio/mpeg",
      });
      chunks.push({ audioObjectKey, plan });
    }

    return chunks;
  }

  return { prepareTranscriptAudioChunks };
}

const transcriptChunkWorker = createTranscriptChunkWorkerAdapter({
  createReadUrl,
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
  putObject,
  runProcess: createProcessRunner(),
});

export const prepareTranscriptAudioChunks =
  transcriptChunkWorker.prepareTranscriptAudioChunks;

export async function transcribePreparedTranscriptChunk(input: {
  chunk: PreparedTranscriptChunk;
  keyterms: string[];
  meetingId: string;
  transcriptJobId: string;
}): Promise<CompletedTranscriptChunk> {
  const audio = await readObjectBytes(
    input.chunk.audioObjectKey,
    TRANSCRIPT_CHUNK_MAX_BYTES,
  );
  const transcript = (await transcribeElevenLabsAudioFile({
    audio,
    fileName: `meeting-${input.meetingId}-chunk-${input.chunk.plan.index + 1}.mp3`,
    keyterms: input.keyterms,
  })) as ElevenLabsChunkTranscript;
  const transcriptObjectKey = input.chunk.audioObjectKey.replace(
    /\.mp3$/,
    ".transcript.json",
  );

  await putObject({
    key: transcriptObjectKey,
    body: new TextEncoder().encode(JSON.stringify(transcript)),
    contentType: "application/json",
  });

  return {
    ...input.chunk,
    transcriptObjectKey,
    transcriptionId: transcript.transcription_id ?? null,
  };
}

export async function persistCompletedTranscriptChunks(input: {
  chunks: CompletedTranscriptChunk[];
  meetingId: string;
  recordingId?: string;
  transcriptJobId: string;
}) {
  const chunks = await Promise.all(
    input.chunks.map(async (chunk) => ({
      plan: chunk.plan,
      transcript: JSON.parse(
        new TextDecoder().decode(
          await readObjectBytes(
            chunk.transcriptObjectKey,
            TRANSCRIPT_RESULT_MAX_BYTES,
          ),
        ),
      ) as ElevenLabsChunkTranscript,
    })),
  );
  const merged = mergeElevenLabsChunkTranscripts(chunks);
  const providerJobId = `chunks:${merged.transcriptionIds.join("+")}`;
  const event = normalizeElevenLabsWebhook({
    type: "speech_to_text_transcription",
    data: {
      request_id: providerJobId,
      webhook_metadata: {
        meetingId: input.meetingId,
        ...(input.recordingId ? { recordingId: input.recordingId } : {}),
        transcriptJobId: input.transcriptJobId,
      },
      transcription: {
        entities: merged.entities,
        status: "completed",
        words: merged.words,
      },
    },
  });
  const result = await applyElevenLabsTranscriptEvent(event);

  if (result.action !== "complete") {
    throw new Error(
      `Unable to persist chunked transcript: ${
        "reason" in result ? result.reason : "provider transcript failed"
      }`,
    );
  }

  const translationLanguage = await getMeetingTranslationLanguage(
    input.meetingId,
  );
  const transcriptText = result.meetingFinalized
    ? await getActiveTranscriptText(input.meetingId)
    : result.text;
  const translateTranscript = shouldAutoTranslateTranscript(
    transcriptText,
    translationLanguage,
  );

  if (result.meetingFinalized) {
    if (translateTranscript) {
      await markMeetingTranslationQueued(input.meetingId);
    } else {
      await markMeetingTranslationCompleted(
        input.meetingId,
        translationLanguage,
      );
    }
  }

  return {
    maxEndMs: result.segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.endMs ?? segment.startMs),
      0,
    ),
    segmentCount: result.segments.length,
    meetingFinalized: result.meetingFinalized,
    translateTranscript,
    translationLanguage,
  };
}

export async function queueChunkedTranscriptEnrichment(input: {
  meetingId: string;
  transcriptJobId: string;
  translateTranscript: boolean;
  translationLanguage: "en" | "zh-CN";
}) {
  return inngest.send({
    id: `transcript-enrichment:${input.transcriptJobId}`,
    name: "meeting/enrich.transcript",
    data: {
      meetingId: input.meetingId,
      translateTranscript: input.translateTranscript,
      translationLanguage: input.translationLanguage,
    },
  });
}

export async function cleanupCompletedTranscriptChunks(
  chunks: CompletedTranscriptChunk[],
) {
  await Promise.all(
    chunks.flatMap((chunk) => [
      deleteObject({ key: chunk.audioObjectKey }),
      deleteObject({ key: chunk.transcriptObjectKey }),
    ]),
  );
}

export async function markChunkedTranscriptJobFailed(input: {
  error: unknown;
  meetingId: string;
  transcriptJobId: string;
}) {
  const errorMessage =
    input.error instanceof Error && input.error.message.trim()
      ? input.error.message
      : "Chunked transcription failed";
  const now = new Date();

  await db
    .update(transcriptJobs)
    .set({ errorMessage, status: "failed", updatedAt: now })
    .where(eq(transcriptJobs.id, input.transcriptJobId));
  await finalizeMeetingTranscriptGeneration(input.meetingId, now);
}

async function probeMediaDurationMs(
  sourceUrl: URL,
  dependencies: TranscriptChunkWorkerDependencies,
) {
  const stdout = await dependencies.runProcess(
    dependencies.ffprobePath,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      sourceUrl.href,
    ],
    { timeoutMs: 60_000 },
  );
  const durationSeconds = Number(new TextDecoder().decode(stdout).trim());

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Unable to determine transcript media duration");
  }

  return Math.round(durationSeconds * 1_000);
}

async function extractAudioChunk(
  sourceUrl: URL,
  plan: TranscriptChunkPlan,
  dependencies: TranscriptChunkWorkerDependencies,
) {
  return dependencies.runProcess(
    dependencies.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      formatSeconds(plan.startMs),
      "-t",
      formatSeconds(plan.endMs - plan.startMs),
      "-i",
      sourceUrl.href,
      "-vn",
      "-map",
      "0:a:0",
      "-acodec",
      "libmp3lame",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      "-f",
      "mp3",
      "pipe:1",
    ],
    {
      maxStdoutBytes: TRANSCRIPT_CHUNK_MAX_BYTES,
      timeoutMs: MEDIA_PROCESS_TIMEOUT_MS,
    },
  );
}

async function readObjectBytes(objectKey: string, maximumBytes: number) {
  const url = await createReadUrl({ key: objectKey });
  const response = await fetch(url, {
    signal: AbortSignal.timeout(MEDIA_PROCESS_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error("Unable to read transcript chunk object");
  }

  const declaredLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("Transcript chunk object is too large");
  }

  const body = new Uint8Array(await response.arrayBuffer());

  if (body.length > maximumBytes) {
    throw new Error("Transcript chunk object is too large");
  }

  return body;
}

function parseTranscriptMediaUrl(value: string) {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !isTrustedTranscriptMediaHost(url.hostname)
  ) {
    throw new Error("Transcript media URL is unsafe");
  }

  return url;
}

function isTrustedTranscriptMediaHost(hostname: string) {
  return (
    hostname === "recall.ai" ||
    hostname.endsWith(".recall.ai") ||
    TRUSTED_RECALL_MEDIA_HOSTS.has(hostname) ||
    hostname.endsWith(".r2.cloudflarestorage.com")
  );
}

function formatSeconds(milliseconds: number) {
  return (milliseconds / 1_000).toFixed(3);
}
