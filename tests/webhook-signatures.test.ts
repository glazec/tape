import { afterEach, describe, expect, it, vi } from "vitest";

describe("webhook signatures", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("can be imported without an ElevenLabs API key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", undefined);

    const webhookModule = await import("@/lib/webhook-signatures");

    expect(webhookModule.verifyElevenLabsWebhook).toBeTypeOf("function");
  });
});
