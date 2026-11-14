import { afterEach, describe, expect, it, vi } from "vitest";

const {
  applyElevenLabsTranscriptEvent,
  createReadUrl,
  findRecallRecordingMediaUrl,
  markTranscriptJobFailedSafely,
  retrieveRecallBot,
  retrieveRecallRecording,
  select,
} = vi.hoisted(() => ({
  applyElevenLabsTranscriptEvent: vi.fn(),
  createReadUrl: vi.fn(),
  findRecallRecordingMediaUrl: vi.fn(),
  markTranscriptJobFailedSafely: vi.fn(),
  retrieveRecallBot: vi.fn(),
  retrieveRecallRecording: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

vi.mock("@/lib/elevenlabs-transcripts", () => ({
  applyElevenLabsTranscriptEvent,
}));

vi.mock("@/lib/r2", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/r2")>(),
  createReadUrl,
}));

vi.mock("@/lib/transcript-job-failure", () => ({
  markTranscriptJobFailedSafely,
}));

vi.mock("@/lib/vendors/recall", () => ({
  findRecallRecordingMediaUrl,
  retrieveRecallBot,
  retrieveRecallRecording,
}));

describe("transcript chunk worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    applyElevenLabsTranscriptEvent.mockReset();
    createReadUrl.mockReset();
    select.mockReset();
    findRecallRecordingMediaUrl.mockReset();
    markTranscriptJobFailedSafely.mockReset();
    retrieveRecallBot.mockReset();
    retrieveRecallRecording.mockReset();
  });

  it("preserves the terminal reason and asks Inngest not to retry empty chunks", async () => {
    const { NonRetriableError } = await import("inngest");
    const { persistCompletedTranscriptChunks } = await import("@/lib/transcript-chunk-worker");
    createReadUrl.mockResolvedValue("https://example.test/chunk.json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ transcription_id: "empty", text: "", words: [] }),
    ));
    applyElevenLabsTranscriptEvent.mockResolvedValue({
      action: "fail",
      errorMessage: "No transcript text returned",
    });
    const result = persistCompletedTranscriptChunks({
      chunks: [{
        audioObjectKey: "chunk.mp3",
        transcriptObjectKey: "chunk.json",
        transcriptionId: "empty",
        plan: { index: 0, startMs: 0, endMs: 60_000, ownershipStartMs: 0, ownershipEndMs: 60_000 },
      }],
      meetingId: "meeting",
      transcriptJobId: "job",
    });

    await expect(result).rejects.toBeInstanceOf(NonRetriableError);
    await expect(result).rejects.toThrow("No transcript text returned");
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
      expect.arrayContaining([
        "-t",
        "3590.000",
        "-reconnect",
        "1",
        "-reconnect_on_network_error",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_delay_max",
        "5",
      ]),
    );
    expect(runProcess.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["-reconnect", "1"]),
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

  it("retrieves a fresh Recall URL when the recovery worker starts", async () => {
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
    const artifact = { id: "recall_bot_123" };
    retrieveRecallBot.mockResolvedValue(artifact);
    findRecallRecordingMediaUrl.mockReturnValue(
      "https://recallai-production-bot-data.s3.amazonaws.com/fresh.mp3",
    );
    const runProcess = vi
      .fn()
      .mockResolvedValueOnce(new TextEncoder().encode("60"))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
    const { createTranscriptChunkWorkerAdapter } = await import(
      "@/lib/transcript-chunk-worker"
    );
    const adapter = createTranscriptChunkWorkerAdapter({
      createReadUrl: vi.fn(),
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      putObject: vi.fn(),
      runProcess,
    });

    await adapter.prepareTranscriptAudioChunks({
      keyterms: [],
      meetingId: "22222222-2222-4222-8222-222222222222",
      recallBotId: "recall_bot_123",
      recallRecordingId: "recall_recording_123",
      transcriptJobId: "33333333-3333-4333-8333-333333333333",
    });

    expect(retrieveRecallBot).toHaveBeenCalledWith("recall_bot_123");
    expect(findRecallRecordingMediaUrl).toHaveBeenCalledWith(
      artifact,
      "recall_recording_123",
    );
    expect(retrieveRecallRecording).not.toHaveBeenCalled();
  });

  it("waits for aggregate finalization after a chunked job fails", async () => {
    markTranscriptJobFailedSafely.mockResolvedValue({
      jobUpdated: true,
      meetingFinalized: false,
    });
    const { markChunkedTranscriptJobFailed } =
      await import("@/lib/transcript-chunk-worker");

    await markChunkedTranscriptJobFailed({
      error: new Error("chunk failed"),
      meetingId: "22222222-2222-4222-8222-222222222222",
      transcriptJobId: "33333333-3333-4333-8333-333333333333",
    });

    expect(markTranscriptJobFailedSafely).toHaveBeenCalledWith({
      errorMessage: "chunk failed",
      meetingId: "22222222-2222-4222-8222-222222222222",
      transcriptJobId: "33333333-3333-4333-8333-333333333333",
    });
  });
});
