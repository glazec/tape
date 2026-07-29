import { afterEach, describe, expect, it, vi } from "vitest";

const {
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  send,
} = vi.hoisted(() => ({
  deleteRecallCalendarEventBot: vi.fn(),
  deleteScheduledRecallBot: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send },
}));

vi.mock("@/lib/vendors/recall", () => ({
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
}));

describe("meeting bot retirement", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("durably removes both the calendar bot configuration and created bot", async () => {
    send.mockResolvedValue({});
    deleteRecallCalendarEventBot.mockResolvedValue({});
    deleteScheduledRecallBot.mockResolvedValue({});
    const { retireRecallCalendarEventBot } = await import(
      "@/lib/meeting-bot-retirement"
    );

    await retireRecallCalendarEventBot({
      botId: "bot_123",
      calendarEventId: "calendar_event_123",
    });

    expect(send).toHaveBeenNthCalledWith(1, {
      id: "delete-recall-calendar-event-bot:calendar_event_123",
      name: "meeting/delete.recall-calendar-event-bot",
      data: { calendarEventId: "calendar_event_123" },
    });
    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "calendar_event_123",
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      id: "delete-recall-bot:bot_123",
      name: "meeting/delete.recall-bot",
      data: { botId: "bot_123" },
    });
    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({
      botId: "bot_123",
    });
  });

  it("uses the queued calendar cleanup when the direct provider call fails", async () => {
    send.mockResolvedValue({});
    deleteRecallCalendarEventBot.mockRejectedValue(
      new Error("provider unavailable"),
    );
    const { retireRecallCalendarEventBot } = await import(
      "@/lib/meeting-bot-retirement"
    );

    await expect(
      retireRecallCalendarEventBot({
        calendarEventId: "calendar_event_123",
      }),
    ).resolves.toBeUndefined();
  });

  it("still retires the created bot when calendar cleanup cannot be queued", async () => {
    send
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce({});
    deleteRecallCalendarEventBot.mockRejectedValue(
      new Error("provider unavailable"),
    );
    deleteScheduledRecallBot.mockResolvedValue({});
    const { retireRecallCalendarEventBot } = await import(
      "@/lib/meeting-bot-retirement"
    );

    await expect(
      retireRecallCalendarEventBot({
        botId: "bot_123",
        calendarEventId: "calendar_event_123",
      }),
    ).rejects.toThrow("provider unavailable");
    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({
      botId: "bot_123",
    });
  });
});
