import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

const { persistRecallMeetingVideoFrames, serve } = vi.hoisted(() => ({
  persistRecallMeetingVideoFrames: vi.fn(),
  serve: vi.fn(() => (_request: unknown, response: {
    end: (body: string) => void;
    writeHead: (status: number, headers?: Record<string, string>) => void;
  }) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ inngest: true }));
  }),
}));

vi.mock("@/lib/meeting-video-frames", () => ({
  persistRecallMeetingVideoFrames,
}));

vi.mock("inngest/node", () => ({ serve }));

type RunnableInngestFunction = {
  fn: (input: unknown) => Promise<unknown>;
};

describe("image worker", () => {
  afterEach(() => {
    persistRecallMeetingVideoFrames.mockReset();
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
    expect(
      buildImageWorkerClientOptions({
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

  it("registers one serialized extraction function with two retries", async () => {
    const { functions } = await import("@/services/image-worker/functions");

    expect(functions).toHaveLength(1);
    expect(functions[0].opts).toMatchObject({
      concurrency: 1,
      id: "extract-meeting-video-frames",
      retries: 2,
      triggers: [{ event: "meeting/extract.video-frames" }],
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
