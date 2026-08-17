import { describe, expect, it } from "vitest";

import { pendingAudioBatchSchema } from "@/lib/pending-audio-batch";
import { MAX_RECORDING_DURATION_MS } from "@/lib/recording-duration";

const file = {
  contentType: "audio/mpeg",
  durationMs: 60_000,
  extension: "mp3",
  fileName: "meeting.mp3",
  uploadId: "upload_1",
};

describe("pending audio batch validation", () => {
  it("accepts two to ten ordered audio uploads", () => {
    expect(
      pendingAudioBatchSchema.safeParse({
        files: [file, { ...file, uploadId: "upload_2" }],
      }).success,
    ).toBe(true);
    expect(
      pendingAudioBatchSchema.safeParse({
        files: Array.from({ length: 10 }, (_, index) => ({
          ...file,
          uploadId: `upload_${index}`,
        })),
      }).success,
    ).toBe(true);
  });

  it("rejects single, oversized, duplicate, and non audio shaped batches", () => {
    expect(pendingAudioBatchSchema.safeParse({ files: [file] }).success).toBe(
      false,
    );
    expect(
      pendingAudioBatchSchema.safeParse({ files: Array(11).fill(file) })
        .success,
    ).toBe(false);
    expect(
      pendingAudioBatchSchema.safeParse({ files: [file, file] }).success,
    ).toBe(false);
    expect(
      pendingAudioBatchSchema.safeParse({
        files: [file, { ...file, durationMs: 0, uploadId: "upload_2" }],
      }).success,
    ).toBe(false);
    expect(
      pendingAudioBatchSchema.safeParse({
        files: [
          { ...file, durationMs: MAX_RECORDING_DURATION_MS, uploadId: "one" },
          { ...file, durationMs: 1, uploadId: "two" },
        ],
      }).success,
    ).toBe(false);
  });
});
