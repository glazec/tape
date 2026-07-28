import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertMeetingHasProviderCredit,
  getStoredMeetingTranslationLanguage,
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationRunning,
  polishTranscriptSegmentsInOriginalLanguage,
  select,
  translateTranscriptSegments,
  update,
} = vi.hoisted(() => ({
  assertMeetingHasProviderCredit: vi.fn(),
  getStoredMeetingTranslationLanguage: vi.fn(),
  markMeetingTranslationCompleted: vi.fn(),
  markMeetingTranslationFailed: vi.fn(),
  markMeetingTranslationRunning: vi.fn(),
  polishTranscriptSegmentsInOriginalLanguage: vi.fn(),
  select: vi.fn(),
  translateTranscriptSegments: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/provider-credit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-credit")>()),
  assertMeetingHasProviderCredit,
}));

vi.mock("@/db/client", () => ({
  db: { select, update },
}));

vi.mock("@/lib/meeting-translation-jobs", () => ({
  getStoredMeetingTranslationLanguage,
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationRunning,
}));

vi.mock("@/lib/vendors/openrouter", () => ({
  polishTranscriptSegmentsInOriginalLanguage,
  TRANSLATION_BATCH_SIZE: 10,
  translateTranscriptSegments,
}));

type RunnableInngestFunction = {
  fn: (input: unknown) => Promise<unknown>;
};

const meetingId = "11111111-1111-4111-8111-111111111111";

function mockSegments(
  overrides: Partial<{
    polishedText: string | null;
    translatedText: string | null;
  }> = {},
) {
  const segment = {
    id: "segment_1",
    polishedText: overrides.polishedText ?? null,
    text: "Um, hello team.",
    translatedText: overrides.translatedText ?? null,
  };
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockImplementation((values) => {
    if ("polishedText" in values) {
      segment.polishedText = values.polishedText;
    }

    if ("translatedText" in values) {
      segment.translatedText = values.translatedText;
    }

    return { where: updateWhere };
  });

  select.mockImplementation((fields: Record<string, unknown>) => {
    const selected = Object.fromEntries(
      Object.keys(fields).map((key) => [
        key,
        segment[key as keyof typeof segment],
      ]),
    );
    const resolve = () => Promise.resolve([selected]);
    const query = {
      from: () => query,
      orderBy: resolve,
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => resolve().then(onFulfilled, onRejected),
      where: () => query,
    };

    return query;
  });
  update.mockReturnValue({ set });
  getStoredMeetingTranslationLanguage.mockResolvedValue("zh-CN");
  const run = vi
    .fn()
    .mockImplementation(
      async (_name: string, handler: () => Promise<unknown>) => handler(),
    );

  return { run, set };
}

describe("enrich transcript", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it(
    "completes translation before polishing and preserves that status if polish fails",
    async () => {
      const { run, set } = mockSegments();
      const polishError = new Error("OpenRouter polish returned no content");

      translateTranscriptSegments.mockImplementation(
        async (_segments, options) => {
          const translations = [{ id: "segment_1", text: "团队好。" }];
          await options.onTranslated(translations);
          return translations;
        },
      );
      polishTranscriptSegmentsInOriginalLanguage.mockRejectedValue(polishError);

      const { enrichTranscript } = await import("@/inngest/functions");

      await expect(
        (enrichTranscript as unknown as RunnableInngestFunction).fn({
          event: {
            data: {
              meetingId,
              translateTranscript: true,
              translationLanguage: "zh-CN",
            },
          },
          step: { run },
        }),
      ).rejects.toThrow("OpenRouter polish returned no content");

      expect(markMeetingTranslationRunning).toHaveBeenCalledWith(
        meetingId,
        "zh-CN",
      );
      expect(markMeetingTranslationCompleted).toHaveBeenCalledWith(
        meetingId,
        "zh-CN",
      );
      expect(markMeetingTranslationFailed).not.toHaveBeenCalled();
      expect(translateTranscriptSegments).toHaveBeenCalledWith(
        [{ id: "segment_1", text: "Um, hello team." }],
        {
          batchSize: 10,
          meetingId,
          onTranslated: expect.any(Function),
          targetLanguage: "zh-CN",
        },
      );
      expect(set).toHaveBeenCalledWith({
        translatedText: "团队好。",
        updatedAt: expect.any(Date),
      });
      expect(
        translateTranscriptSegments.mock.invocationCallOrder[0],
      ).toBeLessThan(
        polishTranscriptSegmentsInOriginalLanguage.mock.invocationCallOrder[0],
      );
      expect(
        markMeetingTranslationCompleted.mock.invocationCallOrder[0],
      ).toBeLessThan(
        polishTranscriptSegmentsInOriginalLanguage.mock.invocationCallOrder[0],
      );
    },
    10_000,
  );

  it("keeps translation running while Inngest still has retries", async () => {
    const { run } = mockSegments();
    const translationError = new Error("OpenRouter translation returned no content");

    translateTranscriptSegments.mockRejectedValue(translationError);

    const { enrichTranscript } = await import("@/inngest/functions");

    await expect(
      (enrichTranscript as unknown as RunnableInngestFunction).fn({
        attempt: 2,
        event: {
          data: {
            meetingId,
            translateTranscript: true,
            translationLanguage: "zh-CN",
          },
        },
        step: { run },
      }),
    ).rejects.toThrow("OpenRouter translation returned no content");

    expect(markMeetingTranslationRunning).toHaveBeenCalledWith(
      meetingId,
      "zh-CN",
    );
    expect(markMeetingTranslationFailed).not.toHaveBeenCalled();
  });

  it("marks translation failed without starting polish when translation fails", async () => {
    const { run } = mockSegments();
    const translationError = new Error("OpenRouter translation returned no content");

    translateTranscriptSegments.mockRejectedValue(translationError);

    const { enrichTranscript } = await import("@/inngest/functions");

    await expect(
      (enrichTranscript as unknown as RunnableInngestFunction).fn({
        attempt: 4,
        event: {
          data: {
            meetingId,
            translateTranscript: true,
            translationLanguage: "zh-CN",
          },
        },
        step: { run },
      }),
    ).rejects.toThrow("OpenRouter translation returned no content");

    expect(markMeetingTranslationFailed).toHaveBeenCalledWith(
      meetingId,
      translationError,
    );
    expect(markMeetingTranslationCompleted).not.toHaveBeenCalled();
    expect(polishTranscriptSegmentsInOriginalLanguage).not.toHaveBeenCalled();
  });

  it("does not move a completed translation back to running during a polish retry", async () => {
    const { run } = mockSegments({ translatedText: "团队好。" });
    polishTranscriptSegmentsInOriginalLanguage.mockRejectedValue(
      new Error("OpenRouter polish returned no content"),
    );

    const { enrichTranscript } = await import("@/inngest/functions");

    await expect(
      (enrichTranscript as unknown as RunnableInngestFunction).fn({
        event: {
          data: {
            meetingId,
            translateTranscript: true,
            translationLanguage: "zh-CN",
          },
        },
        step: { run },
      }),
    ).rejects.toThrow("OpenRouter polish returned no content");

    expect(markMeetingTranslationRunning).not.toHaveBeenCalled();
    expect(markMeetingTranslationCompleted).toHaveBeenCalledWith(
      meetingId,
      "zh-CN",
    );
    expect(markMeetingTranslationFailed).not.toHaveBeenCalled();
    expect(translateTranscriptSegments).not.toHaveBeenCalled();
  });

  it("replaces translations when the team target language changes", async () => {
    const { run, set } = mockSegments({ translatedText: "团队好。" });
    getStoredMeetingTranslationLanguage.mockResolvedValue("zh-CN");
    translateTranscriptSegments.mockImplementation(
      async (_segments, options) => {
        const translations = [{ id: "segment_1", text: "Hello team." }];
        await options.onTranslated(translations);
        return translations;
      },
    );
    polishTranscriptSegmentsInOriginalLanguage.mockResolvedValue([
      { id: "segment_1", text: "Hello team." },
    ]);

    const { enrichTranscript } = await import("@/inngest/functions");

    await (enrichTranscript as unknown as RunnableInngestFunction).fn({
      event: {
        data: {
          meetingId,
          translateTranscript: true,
          translationLanguage: "en",
        },
      },
      step: { run },
    });

    expect(set).toHaveBeenCalledWith({
      translatedText: null,
      updatedAt: expect.any(Date),
    });
    expect(translateTranscriptSegments).toHaveBeenCalledWith(
      [{ id: "segment_1", text: "Um, hello team." }],
      expect.objectContaining({ targetLanguage: "en" }),
    );
    expect(markMeetingTranslationRunning).toHaveBeenCalledWith(
      meetingId,
      "en",
    );
    expect(markMeetingTranslationCompleted).toHaveBeenCalledWith(
      meetingId,
      "en",
    );
  });
});
