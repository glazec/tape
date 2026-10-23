import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ usage: vi.fn(), web: vi.fn() }));
vi.mock("@/lib/provider-usage", () => ({ recordOpenRouterCompletionUsage: mocks.usage }));
vi.mock("@/lib/vendors/exa", () => ({ searchWebWithExa: mocks.web }));
import { generateMeetingNoteAnswer } from "@/lib/vendors/openrouter";

const input = { meetingId: "meeting", question: "Check size?", segments: [{ id: "segment", text: "We invest $2m." }] };
beforeEach(() => { vi.stubEnv("OPENROUTER_API_KEY", "test-key"); vi.stubEnv("OPENROUTER_MODEL", "test-model"); });
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("note question model request", () => {
  it("requests a strict transcript-only answer with usage accounting and a deadline", async () => {
    const output = JSON.stringify({ items: [], missing: ["Check size"] });
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "generation", model: "test-model", choices: [{ finish_reason: "stop", message: { content: output } }], usage: { cost: 0.001, prompt_tokens: 100, completion_tokens: 20 } }));
    vi.stubGlobal("fetch", fetch);
    expect(await generateMeetingNoteAnswer(input)).toBe(output);
    const config = fetch.mock.calls[0][1];
    const body = JSON.parse(config.body);
    expect(config.signal).toBeInstanceOf(AbortSignal);
    expect(body.messages[0].content).toContain("using only the supplied transcript");
    expect(body.messages[0].content).toContain("untrusted data");
    expect(JSON.parse(body.messages[1].content)).toEqual({ question: input.question, transcript: input.segments });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body).not.toHaveProperty("tools"); expect(body).not.toHaveProperty("plugins");
    expect(mocks.web).not.toHaveBeenCalled();
    expect(mocks.usage).toHaveBeenCalledWith(expect.objectContaining({ meetingId: "meeting", category: "assistant", generationId: "generation", usage: expect.objectContaining({ costUsd: 0.001 }) }));
  });
  it("does not multiply automatic requests on failures", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 })); vi.stubGlobal("fetch", fetch);
    await expect(generateMeetingNoteAnswer(input)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated output", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] })));
    await expect(generateMeetingNoteAnswer(input)).rejects.toThrow("token limit");
  });
});
