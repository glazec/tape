import { afterEach, describe, expect, it, vi } from "vitest";

describe("ElevenLabs vendor", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("passes team vocabulary and all entity detection into Scribe", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "eleven-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "req_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createElevenLabsTranscriptJob } = await import(
      "@/lib/vendors/elevenlabs"
    );

    await createElevenLabsTranscriptJob({
      audioUrl: "https://audio.example.com/recording.mp3",
      webhookUrl: "https://app.example.com/api/elevenlabs/webhook",
      keyterms: ["IOSG", "TCG platform"],
      metadata: { meetingId: "meeting_123" },
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = init.body as FormData;

    expect(body.get("model_id")).toBe("scribe_v2");
    expect(body.get("entity_detection")).toBe("all");
    expect(body.get("detect_entities")).toBeNull();
    expect(body.getAll("keyterms")).toEqual(["IOSG", "TCG platform"]);
  });

  it("keeps keyterms inside provider limits before sending them", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "eleven-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "req_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createElevenLabsTranscriptJob } = await import(
      "@/lib/vendors/elevenlabs"
    );

    await createElevenLabsTranscriptJob({
      audioUrl: "https://audio.example.com/recording.mp3",
      webhookUrl: "https://app.example.com/api/elevenlabs/webhook",
      keyterms: [" IOSG ", "iosg", "a".repeat(51), "Ledger"],
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = init.body as FormData;

    expect(body.getAll("keyterms")).toEqual(["IOSG", "Ledger"]);
  });
});
