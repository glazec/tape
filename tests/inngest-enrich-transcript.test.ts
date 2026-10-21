import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertMeetingHasProviderCredit,
  getStoredMeetingTranslationLanguage,
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationFailedIfActive,
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
  markMeetingTranslationFailedIfActive: vi.fn(),
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
  markMeetingTranslationFailedIfActive,
  markMeetingTranslationRunning,
}));

vi.mock("@/lib/vendors/openrouter", () => ({
  polishTranscriptSegmentsInOriginalLanguage,
  TRANSLATION_BATCH_SIZE: 10,
  translateTranscriptSegments,
}));

type RunnableInngestFunction = {
  fn: (input: unknown) => Promise<unknown>;
  onFailureFn: (input: unknown) => Promise<unknown>;
};

const meetingId = "11111111-1111-4111-8111-111111111111";
const transcriptJobId = "22222222-2222-4222-8222-222222222222";

function mockSegments(
  overrides: Partial<{
    polishedText: string | null;
    translatedText: string | null;
  }> = {},
) {
  const segment = {
    id: "segment_1",
    jobId: transcriptJobId,
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
        transcriptJobId,
      );
      expect(markMeetingTranslationCompleted).toHaveBeenCalledWith(
        meetingId,
        "zh-CN",
        transcriptJobId,
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
      transcriptJobId,
    );
    expect(markMeetingTranslationFailed).not.toHaveBeenCalled();
  });

  it("marks an active translation failed after Inngest exhausts retries", async () => {
    const translationError = new Error("OpenRouter translation returned no content");
    const { enrichTranscript } = await import("@/inngest/functions");

    await (
      enrichTranscript as unknown as RunnableInngestFunction
    ).onFailureFn({
      error: translationError,
      event: {
        data: {
          event: {
            data: {
              meetingId,
              transcriptJobId,
              translateTranscript: true,
              translationLanguage: "zh-CN",
            },
          },
        },
      },
    });

    expect(markMeetingTranslationFailedIfActive).toHaveBeenCalledWith(
      meetingId,
      translationError,
      transcriptJobId,
    );
  });

  it("does not mark translation failed when translation was not requested", async () => {
    const { enrichTranscript } = await import("@/inngest/functions");

    await (
      enrichTranscript as unknown as RunnableInngestFunction
    ).onFailureFn({
      error: new Error("OpenRouter polish returned no content"),
      event: {
        data: {
          event: {
            data: {
              meetingId,
              translateTranscript: false,
            },
          },
        },
      },
    });

    expect(markMeetingTranslationFailedIfActive).not.toHaveBeenCalled();
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
      transcriptJobId,
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
      transcriptJobId,
    );
    expect(markMeetingTranslationCompleted).toHaveBeenCalledWith(
      meetingId,
      "en",
      transcriptJobId,
    );
  });

  it("keeps a legacy run bound to its first generation after replacement and replay", async () => {
    mockSegments();
    const completedSteps = new Map<string, unknown>();
    const run = vi.fn(async (name: string, handler: () => Promise<unknown>) => {
      if (completedSteps.has(name)) return completedSteps.get(name);
      const result = await handler();
      completedSteps.set(name, result);
      return result;
    });
    translateTranscriptSegments.mockRejectedValue(new Error("temporary failure"));
    const { enrichTranscript } = await import("@/inngest/functions");
    const worker = enrichTranscript as unknown as RunnableInngestFunction;
    const input = {
      event: { data: { meetingId, translateTranscript: true, translationLanguage: "zh-CN" } },
      step: { run },
    };
    await expect(worker.fn(input)).rejects.toThrow("temporary failure");
    const initialSnapshot = completedSteps.get("load-transcript-enrichment-generation");
    expect(initialSnapshot).toEqual({
      transcriptJobId,
      segments: [{ id: "segment_1", text: "Um, hello team." }],
    });

    // The database now contains a different active generation.
    const queriedConditions: unknown[] = [];
    select.mockImplementation((fields: Record<string, unknown>) => {
      let condition: Parameters<PgDialect["sqlToQuery"]>[0];
      const resolve = () => {
        const query = new PgDialect().sqlToQuery(condition);
        queriedConditions.push(query);
        const replacement = { id: "new_segment", jobId: "33333333-3333-4333-8333-333333333333", text: "Replacement" };
        return Promise.resolve(query.params.includes(transcriptJobId)
          ? []
          : [Object.fromEntries(Object.keys(fields).map((key) => [key, replacement[key as keyof typeof replacement]]))]);
      };
      const query = {
        from: () => query,
        where: (value: typeof condition) => { condition = value; return query; },
        orderBy: resolve,
        then: (fulfilled: (value: unknown) => unknown) => resolve().then(fulfilled),
      };
      return query;
    });
    markMeetingTranslationRunning.mockClear();
    await expect(worker.fn(input)).resolves.toEqual({ polishedCount: 0, translatedCount: 0 });
    expect(completedSteps.get("load-transcript-enrichment-generation")).toBe(initialSnapshot);
    expect(queriedConditions.length).toBeGreaterThan(0);
    expect(translateTranscriptSegments).toHaveBeenCalledTimes(1);
    expect(polishTranscriptSegmentsInOriginalLanguage).not.toHaveBeenCalled();
    expect(markMeetingTranslationRunning).not.toHaveBeenCalled();
    expect(markMeetingTranslationCompleted).not.toHaveBeenCalled();
    expect(markMeetingTranslationFailed).not.toHaveBeenCalled();
  });

  it("does not let a legacy failure callback write state without its captured generation", async () => {
    const { enrichTranscript } = await import("@/inngest/functions");
    await (enrichTranscript as unknown as RunnableInngestFunction).onFailureFn({
      error: new Error("old failure"),
      event: { data: { event: { data: { meetingId, translateTranscript: true } } } },
    });
    expect(markMeetingTranslationFailedIfActive).not.toHaveBeenCalled();
  });

  it("marks a legacy run failure using its durable job after its final retry", async () => {
    const { run } = mockSegments();
    const error = new Error("translation unavailable");
    translateTranscriptSegments.mockRejectedValue(error);
    const { enrichTranscript } = await import("@/inngest/functions");
    await expect((enrichTranscript as unknown as RunnableInngestFunction).fn({
      attempt: 4,
      event: { data: { meetingId, translateTranscript: true } },
      step: { run },
    })).rejects.toThrow("translation unavailable");
    expect(markMeetingTranslationFailedIfActive).toHaveBeenCalledWith(meetingId, error, transcriptJobId);
  });


  it("skips a queued legacy event when a newer replacement already exists", async () => {
    const createdAt = Date.parse("2026-10-21T12:00:00Z");
    let snapshotCondition: Parameters<PgDialect["sqlToQuery"]>[0];
    const query = {
      from: () => query,
      where: (condition: typeof snapshotCondition) => { snapshotCondition = condition; return query; },
      orderBy: async () => [],
    };
    select.mockReturnValue(query);
    const run = vi.fn(async (_name: string, handler: () => Promise<unknown>) => handler());
    const { enrichTranscript } = await import("@/inngest/functions");
    await expect((enrichTranscript as unknown as RunnableInngestFunction).fn({
      event: { ts: createdAt, data: { meetingId, translateTranscript: true } },
      step: { run },
    })).resolves.toEqual({ action: "skipped", reason: "transcript_superseded" });
    const compiled = new PgDialect().sqlToQuery(snapshotCondition!);
    expect(compiled.sql).toContain("replacement.mode = 'replace'");
    expect(compiled.sql).toContain("replacement.created_at >");
    expect(compiled.params).toContainEqual(new Date(createdAt));
    expect(markMeetingTranslationRunning).not.toHaveBeenCalled();
    expect(translateTranscriptSegments).not.toHaveBeenCalled();
  });

});
