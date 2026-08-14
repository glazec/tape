import { afterEach, describe, expect, it, vi } from "vitest";

const { set, where } = vi.hoisted(() => ({
  set: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { update: () => ({ set }) },
}));

describe("meeting translation job state", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("persists every translation lifecycle state", async () => {
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
    const jobs = await import("@/lib/meeting-translation-jobs");

    await jobs.markMeetingTranslationQueued("meeting_123");
    await jobs.markMeetingTranslationRunning("meeting_123", "en");
    await jobs.markMeetingTranslationCompleted("meeting_123");
    await jobs.markMeetingTranslationFailed(
      "meeting_123",
      new Error("provider failed"),
    );
    await jobs.markMeetingTranslationFailedIfActive(
      "meeting_123",
      new Error("provider retry exhausted"),
    );

    expect(set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ translationStatus: "queued" }),
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        translationStartedAt: expect.any(Date),
        translationStatus: "running",
        translationLanguage: "en",
      }),
    );
    expect(set).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        translationCompletedAt: expect.any(Date),
        translationStatus: "completed",
      }),
    );
    expect(set).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        translationErrorMessage: "provider failed",
        translationStatus: "failed",
      }),
    );
    expect(set).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        translationErrorMessage: "provider retry exhausted",
        translationStatus: "failed",
      }),
    );
  });

  it("uses a safe fallback and caps provider error text", async () => {
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
    const { markMeetingTranslationFailed } = await import(
      "@/lib/meeting-translation-jobs"
    );

    await markMeetingTranslationFailed("meeting_123", "unknown");
    await markMeetingTranslationFailed(
      "meeting_123",
      new Error("x".repeat(600)),
    );

    expect(set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ translationErrorMessage: "Translation failed" }),
    );
    expect(set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ translationErrorMessage: "x".repeat(500) }),
    );
  });
});
