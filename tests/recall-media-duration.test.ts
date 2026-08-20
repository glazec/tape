import { describe, expect, it, vi } from "vitest";

import {
  parseMp4DurationMs,
  probeRecallMediaDurationMs,
} from "@/lib/recall-media-duration";

describe("Recall media duration", () => {
  it("reads the MP4 movie header duration", () => {
    expect(parseMp4DurationMs(buildMovieHeader(2_571_358))).toBe(2_571_358);
  });

  it("probes the trailing bytes when the movie header is not at the front", async () => {
    const initialBytes = new Uint8Array(256 * 1024);
    const trailingBytes = new Uint8Array(300_000 - 256 * 1024);
    trailingBytes.set(buildMovieHeader(900_000));
    const fetchMedia = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        rangeResponse(initialBytes, "bytes 0-262143/300000"),
      )
      .mockResolvedValueOnce(
        rangeResponse(trailingBytes, "bytes 262144-299999/300000"),
      );

    await expect(
      probeRecallMediaDurationMs(
        "https://recallai-production-bot-data.s3.amazonaws.com/video.mp4",
        fetchMedia,
      ),
    ).resolves.toBe(900_000);
    expect(fetchMedia).toHaveBeenCalledTimes(2);
  });

  it("rejects media outside Recall's recording hosts", async () => {
    await expect(
      probeRecallMediaDurationMs("https://example.com/video.mp4"),
    ).rejects.toThrow("Untrusted Recall media URL");
  });

  it("allows Recall's regional recording hosts", async () => {
    const fetchMedia = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        rangeResponse(buildMovieHeader(60_000), "bytes 0-63/64"),
      );

    await expect(
      probeRecallMediaDurationMs(
        "https://eu-central-1-recallai-production-bot-data.s3.amazonaws.com/video.mp4",
        fetchMedia,
      ),
    ).resolves.toBe(60_000);
  });
});

function buildMovieHeader(durationMs: number) {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 32);
  bytes.set([0x6d, 0x76, 0x68, 0x64], 8);
  view.setUint8(12, 0);
  view.setUint32(24, 1000);
  view.setUint32(28, durationMs);
  return bytes;
}

function rangeResponse(bytes: Uint8Array, contentRange: string) {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 206,
    headers: {
      "content-length": String(bytes.length),
      "content-range": contentRange,
    },
  });
}
