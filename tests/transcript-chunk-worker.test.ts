import { afterEach, describe, expect, it, vi } from "vitest";

const { finalizeMeetingTranscriptGeneration, select, update } = vi.hoisted(
  () => ({
    finalizeMeetingTranscriptGeneration: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  }),
);

vi.mock("@/db/client", () => ({
  db: {
    select,
    update,
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

vi.mock("@/lib/elevenlabs-transcripts", () => ({
  applyElevenLabsTranscriptEvent: vi.fn(),
  finalizeMeetingTranscriptGeneration,
}));

describe("transcript chunk worker", () => {
  afterEach(() => {
    select.mockReset();
    update.mockReset();
    finalizeMeetingTranscriptGeneration.mockReset();
  });

  it("renders and stores only chunks at or below sixty minutes", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi
            .fn()
            .mockResolvedValue([
              { teamId: "11111111-1111-4111-8111-111111111111" },
            ]),
        }),
      }),
    });
    const createReadUrl = vi.fn();
    const putObject = vi.fn().mockResolvedValue(undefined);
    const runProcess = vi
      .fn()
      .mockResolvedValueOnce(new TextEncoder().encode(String(61 * 60)))
      .mockResolvedValue(new Uint8Array([1, 2, 3]));
    const { createTranscriptChunkWorkerAdapter } =
      await import("@/lib/transcript-chunk-worker");
    const adapter = createTranscriptChunkWorkerAdapter({
      createReadUrl,
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      putObject,
      runProcess,
    });

    const chunks = await adapter.prepareTranscriptAudioChunks({
      audioUrl:
        "https://recallai-production-bot-data.s3.amazonaws.com/recording.mp4",
      keyterms: [],
      meetingId: "22222222-2222-4222-8222-222222222222",
      transcriptJobId: "33333333-3333-4333-8333-333333333333",
    });

    expect(chunks).toHaveLength(2);
    expect(runProcess).toHaveBeenCalledTimes(3);
    expect(runProcess.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["-t", "3590.000"]),
    );
    expect(putObject).toHaveBeenCalledTimes(2);
    expect(
      chunks.every(
        (chunk) => chunk.plan.endMs - chunk.plan.startMs <= 3_600_000,
      ),
    ).toBe(true);
    expect(createReadUrl).not.toHaveBeenCalled();
  });

  it("rejects untrusted remote media before starting ffmpeg", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi
            .fn()
            .mockResolvedValue([
              { teamId: "11111111-1111-4111-8111-111111111111" },
            ]),
        }),
      }),
    });
    const runProcess = vi.fn();
    const { createTranscriptChunkWorkerAdapter } =
      await import("@/lib/transcript-chunk-worker");
    const adapter = createTranscriptChunkWorkerAdapter({
      createReadUrl: vi.fn(),
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      putObject: vi.fn(),
      runProcess,
    });

    await expect(
      adapter.prepareTranscriptAudioChunks({
        audioUrl: "https://attacker.example/media.mp3",
        keyterms: [],
        meetingId: "22222222-2222-4222-8222-222222222222",
        transcriptJobId: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toThrow("unsafe");
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("waits for aggregate finalization after a chunked job fails", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set });
    finalizeMeetingTranscriptGeneration.mockResolvedValue(false);
    const { markChunkedTranscriptJobFailed } =
      await import("@/lib/transcript-chunk-worker");

    await markChunkedTranscriptJobFailed({
      error: new Error("chunk failed"),
      meetingId: "22222222-2222-4222-8222-222222222222",
      transcriptJobId: "33333333-3333-4333-8333-333333333333",
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: "chunk failed",
        status: "failed",
      }),
    );
    expect(update).toHaveBeenCalledOnce();
    expect(finalizeMeetingTranscriptGeneration).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.any(Date),
    );
  });
});
