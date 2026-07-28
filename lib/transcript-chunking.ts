export const TRANSCRIPTION_DIRECT_MAX_DURATION_MS = 60 * 60 * 1_000;
export const TRANSCRIPTION_CHUNK_MAX_DURATION_MS =
  TRANSCRIPTION_DIRECT_MAX_DURATION_MS - 10_000;
export const TRANSCRIPTION_CHUNK_OVERLAP_MS = 10_000;

export type TranscriptChunkPlan = {
  endMs: number;
  index: number;
  ownershipEndMs: number;
  ownershipStartMs: number;
  startMs: number;
};

type ElevenLabsWord = {
  end?: number | null;
  speaker_id?: string | null;
  start?: number | null;
  text?: string;
  type?: string;
};

export type ElevenLabsChunkTranscript = {
  entities?: unknown[];
  text?: string;
  transcription_id?: string;
  words?: ElevenLabsWord[];
};

export function shouldChunkTranscription(durationMs: number | null) {
  return (
    durationMs === null ||
    durationMs > TRANSCRIPTION_DIRECT_MAX_DURATION_MS
  );
}

export function planTranscriptChunks(durationMs: number): TranscriptChunkPlan[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("Recording duration must be positive");
  }

  const chunks: TranscriptChunkPlan[] = [];
  let startMs = 0;

  while (startMs < durationMs) {
    const endMs = Math.min(
      durationMs,
      startMs + TRANSCRIPTION_CHUNK_MAX_DURATION_MS,
    );
    const nextStartMs =
      endMs < durationMs ? endMs - TRANSCRIPTION_CHUNK_OVERLAP_MS : endMs;
    const ownershipBoundaryMs =
      endMs < durationMs
        ? endMs - Math.floor(TRANSCRIPTION_CHUNK_OVERLAP_MS / 2)
        : endMs;

    chunks.push({
      endMs,
      index: chunks.length,
      ownershipEndMs: ownershipBoundaryMs,
      ownershipStartMs:
        chunks.length === 0
          ? 0
          : chunks[chunks.length - 1]!.ownershipEndMs,
      startMs,
    });

    startMs = nextStartMs;
  }

  return chunks;
}

export function mergeElevenLabsChunkTranscripts(
  chunks: Array<{
    plan: TranscriptChunkPlan;
    transcript: ElevenLabsChunkTranscript;
  }>,
) {
  const ordered = [...chunks].sort(
    (left, right) => left.plan.index - right.plan.index,
  );
  const words = ordered.flatMap(({ plan, transcript }) =>
    (transcript.words ?? []).flatMap((word) => {
      const absoluteStartMs = secondsToMs(word.start) + plan.startMs;
      const absoluteEndMs = secondsToMs(word.end) + plan.startMs;
      const midpointMs =
        absoluteEndMs > absoluteStartMs
          ? absoluteStartMs + (absoluteEndMs - absoluteStartMs) / 2
          : absoluteStartMs;

      if (
        midpointMs < plan.ownershipStartMs ||
        midpointMs >= plan.ownershipEndMs
      ) {
        return [];
      }

      return [
        {
          ...word,
          start: absoluteStartMs / 1_000,
          end: absoluteEndMs / 1_000,
        },
      ];
    }),
  );

  return {
    entities: ordered.flatMap(({ transcript }) => transcript.entities ?? []),
    transcriptionIds: ordered.flatMap(({ transcript }) =>
      transcript.transcription_id ? [transcript.transcription_id] : [],
    ),
    words,
  };
}

function secondsToMs(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value * 1_000))
    : 0;
}
