import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterChatCompletion, generateMeetingNoteAnswer, generateOpenRouterChatReply, translateTranscriptSegments } from "@/lib/vendors/openrouter";
const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/lib/vendors/exa", () => ({ searchWebWithExa: search }));
vi.mock("@/lib/provider-usage", () => ({ recordOpenRouterCompletionUsage: vi.fn() }));
const gateway = (text: string) => Response.json({ status: "completed", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text }] }] });
const openrouter = (content: string) => Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key"); vi.stubEnv("OPENROUTER_API_KEY", "router-key"); vi.stubEnv("OPENROUTER_MODEL", "openai/gpt-6-luna");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("Luna workflow routing", () => {
  it("reserves time for fallback within the note answer deadline", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1_000).mockReturnValue(11_000);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi.fn().mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"))
      .mockResolvedValueOnce(openrouter('{"items":[],"missing":["Cost"]}'));
    vi.stubGlobal("fetch", fetch);
    await generateMeetingNoteAnswer({ meetingId: "m", question: "Cost?", segments: [], timeoutMs: 30_000 });
    expect(timeout).toHaveBeenNthCalledWith(1, 15_000);
    expect(timeout).toHaveBeenNthCalledWith(2, 20_000);
  });
  it("uses medium for note answers and falls back on nonexact citations", async () => {
    const invalid = JSON.stringify({ items: [{ text: "Cost is $2.", sources: [{ segmentId: "s1", quote: "Invented quote" }] }], missing: [] });
    const valid = JSON.stringify({ items: [{ text: "Cost is $2.", sources: [{ segmentId: "s1", quote: "Cost is $2." }] }], missing: [] });
    const fetch = vi.fn().mockResolvedValueOnce(gateway(invalid)).mockResolvedValueOnce(openrouter(valid)); vi.stubGlobal("fetch", fetch);
    expect(await generateMeetingNoteAnswer({ meetingId: "m", question: "Cost?", segments: [{ id: "s1", text: "Cost is $2." }] })).toBe(valid);
    const first = JSON.parse(fetch.mock.calls[0][1].body), second = JSON.parse(fetch.mock.calls[1][1].body);
    expect(first.model).toBe("cx/gpt-6-luna-medium"); expect(first.reasoning.effort).toBe("medium");
    expect(first.input[0].content).toContain("Example A:"); expect(first.input[0].content).toContain("Every requested fact whose answer is unavailable");
    expect(second.model).toBe("openai/gpt-6-luna"); expect(second.reasoning.effort).toBe("medium"); expect(second.temperature).toBeUndefined();
  });
  it("uses low for translations and rejects missing segment output before fallback", async () => {
    const good = JSON.stringify({ translations: [{ id: "s1", text: "不晚于周一" }] });
    const fetch = vi.fn().mockResolvedValueOnce(gateway('{"translations":[]}')).mockResolvedValueOnce(openrouter(good)); vi.stubGlobal("fetch", fetch);
    expect(await translateTranscriptSegments([{ id: "s1", text: "By Monday" }], { targetLanguage: "zh-CN" })).toEqual([{ id: "s1", text: "不晚于周一" }]);
    const first = JSON.parse(fetch.mock.calls[0][1].body);
    expect(first.model).toBe("cx/gpt-6-luna-low"); expect(first.input[0].content).toContain("不晚于[day]");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("preserves web tool calls and their results through Responses", async () => {
    vi.stubEnv("EXA_API_KEY", "exa-test-key");
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "completed", output: [{ type: "function_call", call_id: "call-1", name: "search_web", arguments: '{"query":"service status"}' }] })).mockResolvedValueOnce(gateway("Service is degraded. https://status.example.com")); vi.stubGlobal("fetch", fetch);
    search.mockResolvedValue({ results: [{ url: "https://status.example.com", text: "Degraded" }] });
    expect(await generateOpenRouterChatReply({ question: "Current service status?" })).toContain("degraded");
    const first = JSON.parse(fetch.mock.calls[0][1].body), second = JSON.parse(fetch.mock.calls[1][1].body);
    expect(first.tools[0]).toMatchObject({ type: "function", name: "search_web" });
    expect(second.tool_choice).toBe("none");
    expect(second.input).toContainEqual(expect.objectContaining({ type: "function_call_output", call_id: "call-1" }));
    expect(search).toHaveBeenCalledWith("service status");
  });
  it("falls back after a gateway chat timeout and keeps credentials isolated", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError")).mockResolvedValueOnce(openrouter("No private transcript is available.")); vi.stubGlobal("fetch", fetch);
    expect(await generateOpenRouterChatReply({ question: "What did we approve?" })).toContain("No private transcript");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer gateway-key");
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer router-key");
    expect(JSON.parse(fetch.mock.calls[1][1].body).reasoning.effort).toBe("low");
  });
  it("keeps DeepSeek and Jev off the Luna gateway", async () => {
    const fetch = vi.fn().mockImplementation(() => openrouter('{"items":[]}')); vi.stubGlobal("fetch", fetch);
    for (const model of ["deepseek/deepseek-v4.1-flash", "typesafe/jev-router"]) await createOpenRouterChatCompletion({ model, messages: [{ role: "user", content: "test" }], maxTokens: 100, temperature: 0 });
    expect(fetch.mock.calls.every(call => call[0] === "https://openrouter.ai/api/v1/chat/completions")).toBe(true);
  });
});
