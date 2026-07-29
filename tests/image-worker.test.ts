import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  cleanupCompletedTranscriptChunks,
  markChunkedTranscriptJobFailed,
  persistCompletedTranscriptChunks,
  persistRecallMeetingVideoFrames,
  prepareTranscriptAudioChunks,
  queueChunkedTranscriptEnrichment,
  serve,
  transcribePreparedTranscriptChunk,
} = vi.hoisted(() => ({
  cleanupCompletedTranscriptChunks: vi.fn(),
  markChunkedTranscriptJobFailed: vi.fn(),
  persistCompletedTranscriptChunks: vi.fn(),
  persistRecallMeetingVideoFrames: vi.fn(),
  prepareTranscriptAudioChunks: vi.fn(),
  queueChunkedTranscriptEnrichment: vi.fn(),
  serve: vi.fn(() => (_request: unknown, response: {
    end: (body: string) => void;
    writeHead: (status: number, headers?: Record<string, string>) => void;
  }) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ inngest: true }));
  }),
  transcribePreparedTranscriptChunk: vi.fn(),
}));

vi.mock("@/lib/meeting-video-frames", () => ({
  persistRecallMeetingVideoFrames,
}));

vi.mock("@/lib/transcript-chunk-worker", () => ({
  cleanupCompletedTranscriptChunks,
  markChunkedTranscriptJobFailed,
  persistCompletedTranscriptChunks,
  prepareTranscriptAudioChunks,
  queueChunkedTranscriptEnrichment,
  transcribePreparedTranscriptChunk,
}));

vi.mock("inngest/node", () => ({ serve }));

type RunnableInngestFunction = {
  fn: (input: unknown) => Promise<unknown>;
};

describe("image worker", () => {
  afterEach(() => {
    persistRecallMeetingVideoFrames.mockReset();
    cleanupCompletedTranscriptChunks.mockReset();
    markChunkedTranscriptJobFailed.mockReset();
    persistCompletedTranscriptChunks.mockReset();
    prepareTranscriptAudioChunks.mockReset();
    queueChunkedTranscriptEnrichment.mockReset();
    transcribePreparedTranscriptChunk.mockReset();
    serve.mockClear();
    vi.resetModules();
  });

  it("requires a signing key in production", async () => {
    const { buildImageWorkerClientOptions } = await import(
      "@/services/image-worker/client"
    );

    expect(() =>
      buildImageWorkerClientOptions({ NODE_ENV: "production" }),
    ).toThrow("INNGEST_SIGNING_KEY");
    expect(() =>
      buildImageWorkerClientOptions({
        NODE_ENV: "production",
        INNGEST_SIGNING_KEY: "signkey-prod-worker",
      }),
    ).toThrow("ELEVENLABS_API_KEY");
    expect(
      buildImageWorkerClientOptions({
        ELEVENLABS_API_KEY: "eleven-key",
        NODE_ENV: "production",
        INNGEST_BASE_URL: "https://inngest.example.com",
        INNGEST_SIGNING_KEY: "signkey-prod-worker",
      }),
    ).toMatchObject({
      id: "meeting-image-worker",
      baseUrl: "https://inngest.example.com",
      signingKey: "signkey-prod-worker",
    });
  });

  it("registers serialized media functions with two retries", async () => {
    const { functions } = await import("@/services/image-worker/functions");

    expect(functions).toHaveLength(2);
    expect(functions[0].opts).toMatchObject({
      concurrency: 1,
      id: "extract-meeting-video-frames",
      retries: 2,
      triggers: [{ event: "meeting/extract.video-frames" }],
    });
    expect(functions[1].opts).toMatchObject({
      concurrency: 1,
      id: "transcribe-meeting-in-chunks",
      retries: 2,
      triggers: [{ event: "meeting/transcribe.audio-in-chunks" }],
    });
  });

  it("validates the event and delegates extraction", async () => {
    const result = { duplicateCount: 3, frameCount: 14, intervalCount: 2 };
    persistRecallMeetingVideoFrames.mockResolvedValue(result);
    const { extractMeetingVideoFrames } = await import(
      "@/services/image-worker/functions"
    );
    const input = {
      meetingId: "22222222-2222-4222-8222-222222222222",
      recallBotId: "bot_123",
      recallRecordingId: "recording_123",
    };

    await expect(
      (extractMeetingVideoFrames as unknown as RunnableInngestFunction).fn({
        event: { data: input },
      }),
    ).resolves.toEqual(result);
    expect(persistRecallMeetingVideoFrames).toHaveBeenCalledWith(input);
  });

  it("accepts a direct Desktop SDK recording without a bot id", async () => {
    const result = { duplicateCount: 0, frameCount: 2, intervalCount: 1 };
    persistRecallMeetingVideoFrames.mockResolvedValue(result);
    const { extractMeetingVideoFrames } = await import(
      "@/services/image-worker/functions"
    );
    const input = {
      meetingId: "22222222-2222-4222-8222-222222222222",
      recallRecordingId: "recording_123",
    };

    await expect(
      (extractMeetingVideoFrames as unknown as RunnableInngestFunction).fn({
        event: { data: input },
      }),
    ).resolves.toEqual(result);
    expect(persistRecallMeetingVideoFrames).toHaveBeenCalledWith(input);
  });

  it("rejects invalid extraction events before delegation", async () => {
    const { extractMeetingVideoFrames } = await import(
      "@/services/image-worker/functions"
    );

    await expect(
      (extractMeetingVideoFrames as unknown as RunnableInngestFunction).fn({
        event: {
          data: {
            meetingId: "not-a-uuid",
            recallBotId: "",
            recallRecordingId: "recording_123",
          },
        },
      }),
    ).rejects.toThrow();
    expect(persistRecallMeetingVideoFrames).not.toHaveBeenCalled();
  });

  it("checkpoints every long transcript chunk before one merge", async () => {
    const chunks = [
      {
        audioObjectKey: "chunk-0.mp3",
        plan: {
          endMs: 3_600_000,
          index: 0,
          ownershipEndMs: 3_595_000,
          ownershipStartMs: 0,
          startMs: 0,
        },
      },
      {
        audioObjectKey: "chunk-1.mp3",
        plan: {
          endMs: 4_000_000,
          index: 1,
          ownershipEndMs: 4_000_000,
          ownershipStartMs: 3_595_000,
          startMs: 3_590_000,
        },
      },
    ];
    const completed = chunks.map((chunk) => ({
      ...chunk,
      transcriptObjectKey: `${chunk.audioObjectKey}.json`,
      transcriptionId: `transcript_${chunk.plan.index}`,
    }));
    const stepNames: string[] = [];
    const run = vi.fn(
      async (name: string, handler: () => Promise<unknown>) => {
        stepNames.push(name);
        return handler();
      },
    );
    prepareTranscriptAudioChunks.mockResolvedValue(chunks);
    transcribePreparedTranscriptChunk
      .mockResolvedValueOnce(completed[0])
      .mockResolvedValueOnce(completed[1]);
    persistCompletedTranscriptChunks.mockResolvedValue({
      maxEndMs: 4_000_000,
      segmentCount: 320,
      translateTranscript: true,
      translationLanguage: "zh-CN",
    });
    queueChunkedTranscriptEnrichment.mockResolvedValue({ ids: ["enrich"] });
    cleanupCompletedTranscriptChunks.mockResolvedValue(undefined);
    const { transcribeMeetingInChunks } = await import(
      "@/services/image-worker/functions"
    );
    const data = {
      keyterms: ["IOSG"],
      meetingId: "22222222-2222-4222-8222-222222222222",
      objectKey: "users/user_123/uploads/long.mp3",
      recordingId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    };

    await expect(
      (transcribeMeetingInChunks as unknown as RunnableInngestFunction).fn({
        attempt: 0,
        event: { data },
        step: { run },
      }),
    ).resolves.toMatchObject({ segmentCount: 320 });

    expect(stepNames).toEqual([
      "prepare-audio-chunks",
      "transcribe-audio-chunk-0",
      "transcribe-audio-chunk-1",
      "persist-chunked-transcript",
      "queue-chunked-transcript-enrichment",
      "cleanup-transcript-chunks",
    ]);
    expect(persistCompletedTranscriptChunks).toHaveBeenCalledWith({
      chunks: completed,
      meetingId: data.meetingId,
      recordingId: data.recordingId,
      transcriptJobId: data.transcriptJobId,
    });
    expect(markChunkedTranscriptJobFailed).not.toHaveBeenCalled();
  });

  it.each([
    ["enrichment dispatch", "queue-chunked-transcript-enrichment"],
    ["chunk cleanup", "cleanup-transcript-chunks"],
  ])(
    "does not fail a persisted transcript when %s fails",
    async (_failure, failingStep) => {
      const chunk = {
        audioObjectKey: "chunk-0.mp3",
        plan: {
          endMs: 60_000,
          index: 0,
          ownershipEndMs: 60_000,
          ownershipStartMs: 0,
          startMs: 0,
        },
      };
      const completed = {
        ...chunk,
        transcriptObjectKey: "chunk-0.json",
        transcriptionId: "transcript_0",
      };
      prepareTranscriptAudioChunks.mockResolvedValue([chunk]);
      transcribePreparedTranscriptChunk.mockResolvedValue(completed);
      persistCompletedTranscriptChunks.mockResolvedValue({
        maxEndMs: 60_000,
        segmentCount: 4,
        translateTranscript: false,
        translationLanguage: "en",
      });
      queueChunkedTranscriptEnrichment.mockResolvedValue({ ids: ["enrich"] });
      cleanupCompletedTranscriptChunks.mockResolvedValue(undefined);
      const run = vi.fn(
        async (name: string, handler: () => Promise<unknown>) => {
          if (name === failingStep) {
            throw new Error(`${failingStep} unavailable`);
          }

          return handler();
        },
      );
      const { transcribeMeetingInChunks } = await import(
        "@/services/image-worker/functions"
      );
      const data = {
        keyterms: [],
        meetingId: "22222222-2222-4222-8222-222222222222",
        objectKey: "users/user_123/uploads/long.mp3",
        transcriptJobId: "44444444-4444-4444-8444-444444444444",
      };

      await expect(
        (transcribeMeetingInChunks as unknown as RunnableInngestFunction).fn({
          attempt: 2,
          event: { data },
          step: { run },
        }),
      ).rejects.toThrow(`${failingStep} unavailable`);
      expect(persistCompletedTranscriptChunks).toHaveBeenCalledOnce();
      expect(markChunkedTranscriptJobFailed).not.toHaveBeenCalled();
    },
  );

  it("serves health and Inngest while returning 404 elsewhere", async () => {
    const { createImageWorkerServer } = await import(
      "@/services/image-worker/server"
    );
    const server = createImageWorkerServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({
        ok: true,
        service: "meeting-image-worker",
      });

      const inngest = await fetch(`http://127.0.0.1:${port}/api/inngest`);
      expect(inngest.status).toBe(200);
      await expect(inngest.json()).resolves.toEqual({ inngest: true });

      const missing = await fetch(`http://127.0.0.1:${port}/admin`);
      expect(missing.status).toBe(404);
      await expect(missing.text()).resolves.toBe("Not found");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
