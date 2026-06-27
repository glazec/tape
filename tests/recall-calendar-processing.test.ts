import { afterEach, describe, expect, it, vi } from "vitest";

const { autoJoinCalendarEvent, listRecallCalendarEvents, select, update } =
  vi.hoisted(() => ({
    autoJoinCalendarEvent: vi.fn(),
    listRecallCalendarEvents: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db: {
    select,
    update,
  },
}));

vi.mock("@/lib/calendar-auto-join", () => ({
  autoJoinCalendarEvent,
}));

vi.mock("@/lib/vendors/recall", () => ({
  listRecallCalendarEvents,
}));

describe("processRecallCalendarWebhook", () => {
  afterEach(() => {
    autoJoinCalendarEvent.mockReset();
    listRecallCalendarEvents.mockReset();
    select.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("syncs changed Recall calendar events into the existing auto join worker", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "33333333-3333-4333-8333-333333333333",
              teamId: "22222222-2222-4222-8222-222222222222",
              userId: "11111111-1111-4111-8111-111111111111",
              autoJoinEnabled: true,
            },
          ]),
        }),
      }),
    });
    update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    listRecallCalendarEvents.mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        calendar_id: "44444444-4444-4444-8444-444444444444",
        platform_id: "google_event_123",
        ical_uid: "shared_event_123@example.com",
        start_time: "2026-06-30T12:00:00.000Z",
        end_time: "2026-06-30T12:30:00.000Z",
        meeting_url: "https://meet.google.com/abc-defg-hij",
        is_deleted: false,
        raw: {
          summary: "Partner sync",
          originalStartTime: {
            dateTime: "2026-06-30T12:00:00.000Z",
          },
          attendees: [{ email: "alice@example.com" }],
        },
      },
    ]);
    autoJoinCalendarEvent.mockResolvedValue({
      action: "scheduled",
      recallBotId: "bot_123",
    });

    const { processRecallCalendarWebhook } = await import("@/lib/recall-calendar");

    await expect(
      processRecallCalendarWebhook({
        eventType: "calendar.sync_events",
        calendarId: "44444444-4444-4444-8444-444444444444",
        lastUpdatedTs: "2026-06-30T11:00:00.000Z",
      }),
    ).resolves.toEqual({ action: "synced", count: 1 });

    expect(listRecallCalendarEvents).toHaveBeenCalledWith({
      calendarId: "44444444-4444-4444-8444-444444444444",
      updatedAtGte: "2026-06-30T11:00:00.000Z",
    });
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith({
      connection: {
        id: "33333333-3333-4333-8333-333333333333",
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        autoJoinEnabled: true,
      },
      event: expect.objectContaining({
        externalEventId: "google_event_123",
        recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
        recallCalendarEventDeduplicationKey:
          "shared_event_123@example.com:2026-06-30T12:00:00.000Z",
        title: "Partner sync",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        attendeeEmails: ["alice@example.com"],
      }),
    });
  });
});
