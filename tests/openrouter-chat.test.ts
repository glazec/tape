import { afterEach, describe, expect, it, vi } from "vitest";

describe("OpenRouter meeting chat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("retries when the model stops at the output token limit", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "qwen/qwen3.7-plus");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: "This answer is cut" },
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
                message: { content: "This answer is complete." },
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
      generateOpenRouterChatReply({ question: "Explain binary options." }),
    ).resolves.toBe("This answer is complete.");
    expect(fetchMock).toHaveBeenCalledTimes(2);

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
