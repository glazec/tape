import { afterEach, describe, expect, it, vi } from "vitest";

describe("OpenRouter translation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("translates transcript segments through the configured model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"translations":[{"id":"segment_1","text":"大家好"}]}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { translateTranscriptSegmentsToChinese } = await import(
      "@/lib/vendors/openrouter"
    );

    await expect(
      translateTranscriptSegmentsToChinese([
        { id: "segment_1", text: "Hello team" },
      ]),
    ).resolves.toEqual([{ id: "segment_1", text: "大家好" }]);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
  });
});
