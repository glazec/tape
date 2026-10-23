import { afterEach, describe, expect, it, vi } from "vitest";

const { recordOpenRouterCompletionUsage } = vi.hoisted(() => ({ recordOpenRouterCompletionUsage: vi.fn() }));
vi.mock("@/lib/provider-usage", () => ({ recordOpenRouterCompletionUsage }));
import { generateMeetingNotes } from "@/lib/vendors/openrouter";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("meeting notes generation", () => {
  it("requests grounded plain text notes and records provider cost", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_MODEL", "test-model");
    const fetch = vi.fn().mockResolvedValue(Response.json({
      id: "generation-id", model: "test-model",
      choices: [{ finish_reason: "stop", message: { content: "决定周一发布。" } }],
      usage: { cost: 0.001, prompt_tokens: 100, completion_tokens: 10 },
    }));
    vi.stubGlobal("fetch", fetch);
    await expect(generateMeetingNotes({ meetingId: "meeting-id", title: "讨论", transcript: "[00:00] Jocy: 我们周一发布。" }))
      .resolves.toBe("决定周一发布。");
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.response_format).toEqual({ type: "text" });
    expect(request.messages[0].content).toContain("Do not invent");
    expect(JSON.parse(request.messages[1].content).transcript).toContain("我们周一发布。");
    expect(recordOpenRouterCompletionUsage).toHaveBeenCalledWith(expect.objectContaining({
      category: "assistant", generationId: "generation-id", meetingId: "meeting-id",
      usage: expect.objectContaining({ costUsd: 0.001 }),
    }));
  });

  it("rejects truncated notes instead of sending an incomplete summary", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_MODEL", "test-model");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({
      choices: [{ finish_reason: "length", message: { content: "Incomplete" } }],
    })));
    await expect(generateMeetingNotes({ meetingId: "meeting-id", title: "Meeting", transcript: "Discuss" }))
      .rejects.toThrow("token limit");
  });
});
