import { afterEach, describe, expect, it, vi } from "vitest";

const {
  insert,
  scheduleRecallBot,
  select,
  update,
} = vi.hoisted(() => ({
  insert: vi.fn(),
  scheduleRecallBot: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
    update,
  },
}));

vi.mock("@/lib/vendors/recall", () => ({
  DEFAULT_RECALL_BOT_NAME: "IOSG Old Friend",
  scheduleRecallBot,
}));

describe("calendar auto join", () => {
  afterEach(() => {
    insert.mockReset();
    scheduleRecallBot.mockReset();
    select.mockReset();
    update.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("extracts a conferencing meeting link when the calendar event has no location", async () => {
    const { findCalendarMeetingUrl } = await import("@/lib/calendar-auto-join");

    expect(
      findCalendarMeetingUrl({
        externalEventId: "google_event_123",
        title: "Partner sync",
        startsAt: "2026-06-30T12:00:00.000Z",
        location: null,
        conferenceData: {
          entryPoints: [
            {
              entryPointType: "video",
              uri: "https://meet.google.com/abc-defg-hij",
            },
          ],
        },
      }),
    ).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("schedules Recall for an auto join event with a meeting link and no location", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const attendeeOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const attendeeValues = vi
      .fn()
      .mockReturnValue({ onConflictDoNothing: attendeeOnConflictDoNothing });

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues })
      .mockReturnValueOnce({ values: attendeeValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          endsAt: null,
          attendeeEmails: [
            " Alice@Example.com ",
            "alice@example.com",
            "guest@vendor.com",
          ],
          location: null,
          conferenceData: {
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/abc-defg-hij",
              },
            ],
          },
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(calendarEventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "11111111-1111-4111-8111-111111111111",
        externalEventId: "google_event_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        teamId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        ownerUserId: "55555555-5555-4555-8555-555555555555",
        platform: "google_meet",
        status: "scheduled",
        teamId: "22222222-2222-4222-8222-222222222222",
        title: "Partner sync",
      }),
    );
    expect(attendeeValues).toHaveBeenCalledWith([
      {
        email: "alice@example.com",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
      {
        email: "guest@vendor.com",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    ]);
    expect(scheduleRecallBot).toHaveBeenCalledWith({
      botName: "IOSG Old Friend",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
      startAt: "2026-06-30T12:00:00.000Z",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
      }),
    );
  });

  it("retries Recall scheduling for an existing calendar meeting without a bot", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: null,
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
        },
        event: {
          externalEventId: "google_event_123",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          location: null,
          conferenceData: {
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/abc-defg-hij",
              },
            ],
          },
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(scheduleRecallBot).toHaveBeenCalledWith({
      botName: "IOSG Old Friend",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
      startAt: "2026-06-30T12:00:00.000Z",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
        status: "scheduled",
      }),
    );
  });
});
