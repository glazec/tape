import { afterEach, describe, expect, it, vi } from "vitest";

const { limit, select, update, returning, whereUpdate } = vi.hoisted(() => ({
  limit: vi.fn(),
  select: vi.fn(),
  update: vi.fn(), returning: vi.fn(), whereUpdate: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select, update,
  },
}));

afterEach(() => {
  limit.mockReset();
  select.mockReset(); update.mockReset(); returning.mockReset(); whereUpdate.mockReset();
});

describe("meeting bot lineage", () => {
  it("accepts only the meeting's current Recall bot", async () => {
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    select.mockReturnValue({ from });
    limit.mockResolvedValue([{ recallBotId: "canonical_bot" }]);
    const { isRecallBotAccepted } = await import("@/lib/meeting-bot-lineage");

    await expect(
      isRecallBotAccepted({
        botId: "canonical_bot",
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toBe(true);
    await expect(
      isRecallBotAccepted({
        botId: "displaced_bot",
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toBe(false);
  });

  it("confirms only a claimed continuation after a lost provider response", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });
    limit.mockResolvedValue([{ recallBotId: null }]);
    update.mockReturnValue({ set: () => ({ where: whereUpdate }) });
    whereUpdate.mockReturnValue({ returning }); returning.mockResolvedValue([{ id: "meeting" }]);
    const { isRecallBotAccepted } = await import("@/lib/meeting-bot-lineage");
    expect(await isRecallBotAccepted({ botId: "confirmed", meetingId: "meeting" })).toBe(true);
    const query = new PgDialect().sqlToQuery(whereUpdate.mock.calls[0][0]);
    expect(query.sql).toContain("kind='continuation'");
    expect(query.sql).toContain("dispatch_state='dispatching'");
    returning.mockResolvedValue([]);
    expect(await isRecallBotAccepted({ botId: "unclaimed", meetingId: "meeting" })).toBe(false);
  });

  it("reads the meeting and bot identity from realtime payload metadata", async () => {
    const { getRecallWebhookBotIdentity } =
      await import("@/lib/meeting-bot-lineage");

    expect(
      getRecallWebhookBotIdentity({
        data: {
          bot: {
            id: "bot_123",
            metadata: {
              meetingId: "11111111-1111-4111-8111-111111111111",
            },
          },
        },
      }),
    ).toEqual({
      botId: "bot_123",
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
