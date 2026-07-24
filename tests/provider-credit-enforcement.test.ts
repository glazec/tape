import { afterEach, describe, expect, it, vi } from "vitest";

const { deleteScheduledRecallBot, execute, update } = vi.hoisted(() => ({
  deleteScheduledRecallBot: vi.fn(),
  execute: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute, update },
}));

vi.mock("@/lib/vendors/recall", () => ({
  deleteScheduledRecallBot,
}));

describe("provider credit enforcement", () => {
  afterEach(() => {
    deleteScheduledRecallBot.mockReset();
    execute.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("deletes scheduled bots and marks their meetings failed", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set });
    execute.mockResolvedValue({
      rows: [
        {
          meeting_id: "11111111-1111-4111-8111-111111111111",
          recall_bot_id: "bot_123",
        },
      ],
    });
    deleteScheduledRecallBot.mockResolvedValue({});
    const { stopBotsForExhaustedWorkspaces } = await import(
      "@/lib/provider-credit-enforcement"
    );

    await expect(stopBotsForExhaustedWorkspaces()).resolves.toEqual({
      failed: 0,
      stopped: 1,
    });

    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({ botId: "bot_123" });
    expect(set).toHaveBeenCalledWith({
      recallBotId: null,
      status: "failed",
      updatedAt: expect.any(Date),
    });
    expect(where).toHaveBeenCalledOnce();
  });

  it("leaves the database record scheduled when Recall deletion fails", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          meeting_id: "11111111-1111-4111-8111-111111111111",
          recall_bot_id: "bot_123",
        },
      ],
    });
    deleteScheduledRecallBot.mockRejectedValue(new Error("Recall unavailable"));
    const { stopBotsForExhaustedWorkspaces } = await import(
      "@/lib/provider-credit-enforcement"
    );

    await expect(stopBotsForExhaustedWorkspaces()).resolves.toEqual({
      failed: 1,
      stopped: 0,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
