import { describe, expect, it } from "vitest";

import {
  mergeElevenLabsChunkTranscripts,
  planTranscriptChunks,
  shouldChunkTranscription,
  TRANSCRIPTION_CHUNK_MAX_DURATION_MS,
  TRANSCRIPTION_DIRECT_MAX_DURATION_MS,
} from "@/lib/transcript-chunking";

describe("transcript chunking", () => {
  it("routes unknown and over limit recordings through chunking", () => {
    expect(shouldChunkTranscription(null)).toBe(true);
    expect(
      shouldChunkTranscription(TRANSCRIPTION_DIRECT_MAX_DURATION_MS),
    ).toBe(false);
    expect(
      shouldChunkTranscription(TRANSCRIPTION_DIRECT_MAX_DURATION_MS + 1),
    ).toBe(true);
  });

  it("keeps every chunk at or below sixty minutes with overlap", () => {
    const chunks = planTranscriptChunks(160 * 60 * 1_000);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({
      endMs: 3_590_000,
      ownershipEndMs: 3_585_000,
      ownershipStartMs: 0,
      startMs: 0,
    });
    expect(chunks[1]).toMatchObject({
      endMs: 7_170_000,
      ownershipEndMs: 7_165_000,
      ownershipStartMs: 3_585_000,
      startMs: 3_580_000,
    });
    expect(chunks.at(-1)?.endMs).toBe(9_600_000);
    expect(
      chunks.every(
        (chunk) =>
          chunk.endMs - chunk.startMs <=
          TRANSCRIPTION_CHUNK_MAX_DURATION_MS,
      ),
    ).toBe(true);
  });

  it("keeps one copy of words in the overlap", () => {
    const [first, second] = planTranscriptChunks(61 * 60 * 1_000);
    const merged = mergeElevenLabsChunkTranscripts([
      {
        plan: first!,
        transcript: {
          transcription_id: "part_1",
          words: [
            { start: 3_584, end: 3_584.2, text: "before" },
            { start: 3_587, end: 3_587.2, text: "duplicate" },
          ],
        },
      },
      {
        plan: second!,
        transcript: {
          transcription_id: "part_2",
          words: [
            { start: 4, end: 4.2, text: "duplicate" },
            { start: 7, end: 7.2, text: "after" },
          ],
        },
      },
    ]);

    expect(merged.words.map((word) => word.text)).toEqual([
      "before",
      "after",
    ]);
    expect(merged.words.at(-1)?.start).toBe(3_587);
    expect(merged.transcriptionIds).toEqual(["part_1", "part_2"]);
  });
});
