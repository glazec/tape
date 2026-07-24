import { afterEach, describe, expect, it, vi } from "vitest";

const { recordOpenRouterCompletionUsage } = vi.hoisted(() => ({
  recordOpenRouterCompletionUsage: vi.fn(),
}));

vi.mock("@/lib/provider-usage", () => ({
  recordOpenRouterCompletionUsage,
}));

describe("OpenRouter meeting chat", () => {
  afterEach(() => {
    recordOpenRouterCompletionUsage.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("retries when the model stops at the output token limit", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "qwen/qwen3.7-plus");
    recordOpenRouterCompletionUsage.mockRejectedValue(
      new Error("usage ledger unavailable"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "generation_1",
            model: "qwen/qwen3.7-plus",
            choices: [
              {
                finish_reason: "length",
                message: { content: "This answer is cut" },
              },
            ],
            usage: {
              completion_tokens: 20,
              cost: 0.0004,
              prompt_tokens: 80,
              total_tokens: 100,
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "generation_2",
            model: "qwen/qwen3.7-plus",
            choices: [
              {
                finish_reason: "stop",
                message: { content: "This answer is complete." },
              },
            ],
            usage: {
              completion_tokens: 30,
              cost: 0.0005,
              prompt_tokens: 90,
              total_tokens: 120,
            },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { generateOpenRouterChatReply } = await import(
      "@/lib/vendors/openrouter"
    );

    await expect(
      generateOpenRouterChatReply({
        meetingId: "11111111-1111-4111-8111-111111111111",
        question: "Explain binary options.",
      }),
    ).resolves.toBe("This answer is complete.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(recordOpenRouterCompletionUsage).toHaveBeenNthCalledWith(2, {
      category: "assistant",
      generationId: "generation_2",
      meetingId: "11111111-1111-4111-8111-111111111111",
      model: "qwen/qwen3.7-plus",
      usage: {
        completionTokens: 30,
        costUsd: 0.0005,
        promptTokens: 90,
        totalTokens: 120,
      },
    });

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.max_tokens).toBeGreaterThan(240);
    expect(secondBody.max_tokens).toBeGreaterThan(firstBody.max_tokens);
  });

  it("lets the model use Exa for questions that need web search", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "qwen/qwen3.7-plus");
    vi.stubEnv("EXA_API_KEY", "exa-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_search_1",
                      type: "function",
                      function: {
                        name: "search_web",
                        arguments:
                          '{"query":"binary options leverage history in TradFi"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            answer: "Binary options were widely marketed before restrictions.",
            citations: [
              {
                title: "Regulator history",
                url: "https://regulator.example/binary-options",
                publishedDate: "2025-01-01",
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content:
                    "Binary options were widely marketed before regulators restricted them.",
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { generateOpenRouterChatReply } = await import(
      "@/lib/vendors/openrouter"
    );

    await expect(
      generateOpenRouterChatReply({
        botName: "Example Notetaker",
        question: "Were leveraged binary options ever popular in TradFi?",
        participantName: "Alice",
        recentMessages: [
          { participantName: "Bob", text: "TradFi used similar products." },
          { participantName: "Alice", text: "How were they structured?" },
        ],
      }),
    ).resolves.toContain("regulators restricted them");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://openrouter.ai/api/v1/chat/completions",
      "https://api.exa.ai/answer",
      "https://openrouter.ai/api/v1/chat/completions",
    ]);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(firstBody.messages[0].content).toContain(
      "You are Example Notetaker",
    );
    expect(firstBody.messages.slice(1)).toEqual([
      {
        role: "user",
        content: "Bob said in the meeting chat:\nTradFi used similar products.",
      },
      {
        role: "user",
        content: "Alice said in the meeting chat:\nHow were they structured?",
      },
      {
        role: "user",
        content:
          "Alice asked in the meeting chat:\nWere leveraged binary options ever popular in TradFi?",
      },
    ]);
    expect(firstBody).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      tools: [
        {
          type: "function",
          function: { name: "search_web" },
        },
      ],
    });

    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({ "x-api-key": "exa-key" }),
      body: JSON.stringify({
        query: "binary options leverage history in TradFi",
        text: false,
      }),
    });

    const finalBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(finalBody).toMatchObject({
      tool_choice: "none",
      tools: [
        {
          type: "function",
          function: { name: "search_web" },
        },
      ],
    });
    expect(finalBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          tool_calls: expect.any(Array),
        }),
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call_search_1",
          content: expect.stringContaining("https://regulator.example/binary-options"),
        }),
      ]),
    );
  });
});
