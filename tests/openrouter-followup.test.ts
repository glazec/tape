import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterChatCompletion, generateMeetingFollowup } from "@/lib/vendors/openrouter";

const { recordUsage } = vi.hoisted(() => ({ recordUsage: vi.fn() }));
vi.mock("@/lib/provider-usage", () => ({
  recordOpenRouterCompletionUsage: recordUsage,
}));

const source = {
  title: "Meeting",
  startedAt: null,
  segments: [
    { id: "one", speaker: "Alex", startMs: 0, text: "I will send the deck." },
  ],
};
const output = {
  todos: [
    {
      person: "Alex",
      text: "Alex will send the deck.",
      timing: null,
      evidence: [{ segmentId: "one", quote: "I will send the deck." }],
    },
  ],
  dynamics: [], research: [],
};
const completion = (result: unknown) =>
  Response.json({
    id: "generation",
    model: "openai/gpt-6-luna",
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(result) } },
    ],
    usage: { cost: 0.01 },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function setup() {
  vi.stubEnv("AI_GATEWAY_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OPENROUTER_MODEL", "assistant-model");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("followup provider", () => {
  const gatewayResponse = (content: string, status = "completed") => Response.json({
    status, model: "gpt-6-luna",
    output: [{ type: "message", content: [{ type: "output_text", text: content }] }],
    usage: { input_tokens: 100, output_tokens: 50 },
  });

  it("uses the gateway first without recording a fabricated OpenRouter charge", async () => {
    const fetch = setup().mockResolvedValue(gatewayResponse(JSON.stringify(output)));
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
    expect(await generateMeetingFollowup(source, "meeting-id")).toEqual(output);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://aigateway.inevitable.tech/v1/responses");
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.model).toBe("cx/gpt-6-luna-low");
    expect(request.reasoning).toEqual({ effort: "low" });
    expect(request.store).toBe(false);
    expect(request.text.format.schema.properties.connections.items.required).toContain("mutual");
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it.each(["timeout", "http", "empty", "incomplete", "invalid_json", "invalid_evidence"])(
    "falls back to OpenRouter when the gateway returns %s", async (failure) => {
      const fetch = setup();
      vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
      const timeout = vi.spyOn(AbortSignal, "timeout");
      if (failure === "timeout") fetch.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"));
      else if (failure === "http") fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
      else if (failure === "empty") fetch.mockResolvedValueOnce(gatewayResponse(""));
      else if (failure === "incomplete") fetch.mockResolvedValueOnce(gatewayResponse(JSON.stringify(output), "incomplete"));
      else if (failure === "invalid_json") fetch.mockResolvedValueOnce(gatewayResponse("not JSON"));
      else fetch.mockResolvedValueOnce(gatewayResponse(JSON.stringify({ ...output, todos: [{ ...output.todos[0], evidence: [{ segmentId: "missing", quote: "invented" }] }] })));
      fetch.mockResolvedValueOnce(completion(output));
      expect(await generateMeetingFollowup(source, "meeting-id")).toEqual(output);
      expect(timeout).toHaveBeenNthCalledWith(1, 30_000);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer test-key");
      expect(JSON.parse(fetch.mock.calls[1][1].body).model).toBe("openai/gpt-6-luna");
      expect(recordUsage).toHaveBeenCalledOnce();
      timeout.mockRestore();
    },
  );

  it("sends explicit extraction reasoning instead of the assistant default", async () => {
    const fetch = setup().mockResolvedValue(completion({ items: [] }));
    await createOpenRouterChatCompletion({
      model: "z-ai/glm-5.3-flash", reasoningEffort: "max",
      messages: [{ role: "user", content: "Extract claims" }], maxTokens: 10000, temperature: 0,
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).reasoning).toEqual({ effort: "max" });
  });

  it("uses the tested model and full transcript with strict output and usage accounting", async () => {
    const fetch = setup().mockResolvedValue(completion(output));
    expect(await generateMeetingFollowup(source, "meeting-id")).toEqual(output);
    const request = JSON.parse(fetch.mock.calls[0][1].body);
    expect(request.model).toBe("openai/gpt-6-luna");
    expect(request.temperature).toBeUndefined();
    expect(request.reasoning).toEqual({ effort: "low" });
    expect(request.messages[0].content).toContain("Example 1: Do not infer a relationship from reported speech.");
    expect(request.messages[0].content).toContain("For each research item, choose evidence FIRST.");
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.response_format.json_schema.schema.required).toContain("research");
    expect(request.response_format.json_schema.schema.required).toContain("connections");
    expect(request.response_format.json_schema.schema.properties.connections.maxItems).toBeUndefined();
    expect(request.messages[0].content).toContain("debt financing, private credit sales");
    expect(request.messages[0].content).toContain("talked to, reviewed or invested in");
    expect(request.response_format.json_schema.schema.properties.research.items.required).toEqual(
      expect.arrayContaining(["question", "context", "evidenceToCollect", "evidence"]),
    );
    expect(request.messages[0].content).toContain(
      "Replace ALL personal and possessive pronouns",
    );
    expect(JSON.parse(request.messages[1].content)).toEqual({ transcript: source, recentCompanyHints: [] });
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "meeting-id",
        category: "assistant",
      }),
    );
  });

  it("retries invalid prose, then drops repeated pronoun items instead of saving them", async () => {
    const invalid = {
      ...output,
      todos: [
        { ...output.todos[0], text: "Alex says they will send the deck." },
      ],
    };
    const fetch = setup().mockImplementation(() => completion(invalid));
    await expect(generateMeetingFollowup(source)).resolves.toEqual({
      todos: [],
      dynamics: [], research: [],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetch.mock.calls[1][1].body).messages[0].content,
    ).toContain("validation failure");
  });

  it("recovers from a wrong evidence citation", async () => {
    const fetch = setup()
      .mockResolvedValueOnce(
        completion({
          ...output,
          todos: [
            {
              ...output.todos[0],
              evidence: [{ segmentId: "bad", quote: "invented" }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(completion(output));
    expect(await generateMeetingFollowup(source)).toEqual(output);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps grounded items when one item still fails after the retry", async () => {
    const mixed = {
      todos: [
        output.todos[0],
        { ...output.todos[0], text: "Alex will send the deck to them." },
      ],
      dynamics: [], research: [],
    };
    setup().mockImplementation(() => completion(mixed));
    await expect(generateMeetingFollowup(source)).resolves.toEqual(output);
  });

  it("still fails when the provider never returns valid JSON", async () => {
    setup().mockImplementation(() =>
      Response.json({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }),
    );
    await expect(generateMeetingFollowup(source)).rejects.toThrow("explicit names");
  });

  it("never silently truncates long input", async () => {
    const fetch = setup();
    await expect(
      generateMeetingFollowup({
        ...source,
        segments: [{ ...source.segments[0], text: "x".repeat(400001) }],
      }),
    ).rejects.toThrow("too long");
    expect(fetch).not.toHaveBeenCalled();
  });
});
