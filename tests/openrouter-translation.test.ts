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
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      response_format: { type: "json_object" },
    });
  });

  it("polishes transcript segments in their original language", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "qwen/qwen3.7-plus");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"segments":[{"id":"segment_1","text":"我们先看 pipeline。"}]}',
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

    const { polishTranscriptSegmentsInOriginalLanguage } = await import(
      "@/lib/vendors/openrouter"
    );

    await expect(
      polishTranscriptSegmentsInOriginalLanguage([
        { id: "segment_1", text: "然后我们先看一下 pipeline。" },
      ]),
    ).resolves.toEqual([{ id: "segment_1", text: "我们先看 pipeline。" }]);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.model).toBe("qwen/qwen3.7-plus");
    expect(body.messages[0].content).toContain("Do not translate");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("translates long transcripts in bounded batches", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const userMessage = body.messages.find(
        (message: { role: string }) => message.role === "user",
      );
      const payload = JSON.parse(userMessage.content);

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: payload.segments.map(
                    (segment: { id: string }) => ({
                      id: segment.id,
                      text: `翻译 ${segment.id}`,
                    }),
                  ),
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { translateTranscriptSegmentsToChinese } = await import(
      "@/lib/vendors/openrouter"
    );
    const segments = Array.from({ length: 45 }, (_, index) => ({
      id: `segment_${index}`,
      text: `Line ${index}`,
    }));

    await expect(
      translateTranscriptSegmentsToChinese(segments, { batchSize: 20 }),
    ).resolves.toHaveLength(45);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses smaller default translation batches", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const userMessage = body.messages.find(
        (message: { role: string }) => message.role === "user",
      );
      const payload = JSON.parse(userMessage.content);

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: payload.segments.map(
                    (segment: { id: string }) => ({
                      id: segment.id,
                      text: `翻译 ${segment.id}`,
                    }),
                  ),
                }),
              },
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { translateTranscriptSegmentsToChinese } = await import(
      "@/lib/vendors/openrouter"
    );
    const segments = Array.from({ length: 21 }, (_, index) => ({
      id: `segment_${index}`,
      text: `Line ${index}`,
    }));

    await expect(translateTranscriptSegmentsToChinese(segments)).resolves.toHaveLength(
      21,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("splits long transcript rows by text size", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5");
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const userMessage = body.messages.find(
        (message: { role: string }) => message.role === "user",
      );
      const payload = JSON.parse(userMessage.content);

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: payload.segments.map(
                    (segment: { id: string }) => ({
                      id: segment.id,
                      text: `翻译 ${segment.id}`,
                    }),
                  ),
                }),
              },
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { translateTranscriptSegmentsToChinese } = await import(
      "@/lib/vendors/openrouter"
    );
    const segments = Array.from({ length: 3 }, (_, index) => ({
      id: `segment_${index}`,
      text: "Long line ".repeat(220),
    }));

    await expect(translateTranscriptSegmentsToChinese(segments)).resolves.toHaveLength(
      3,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
