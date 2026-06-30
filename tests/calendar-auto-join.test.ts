import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  getMeetingBotProfile,
  insert,
  scheduleRecallCalendarEventBot,
  scheduleRecallBot,
  select,
  update,
  updateScheduledRecallBot,
} = vi.hoisted(() => ({
  deleteRecallCalendarEventBot: vi.fn(),
  deleteScheduledRecallBot: vi.fn(),
  getMeetingBotProfile: vi.fn(),
  insert: vi.fn(),
  scheduleRecallCalendarEventBot: vi.fn(),
  scheduleRecallBot: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  updateScheduledRecallBot: vi.fn(),
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
  deleteRecallCalendarEventBot,
  deleteScheduledRecallBot,
  scheduleRecallCalendarEventBot,
  scheduleRecallBot,
  updateScheduledRecallBot,
}));

vi.mock("@/lib/meeting-bot-profile", () => ({
  getMeetingBotProfile,
  getMeetingBotMetadata: (profile: {
    botName: string;
    avatarJpegBase64: string | null;
  }) => (profile.botName === "IOSG Old Friend" ? {} : { botName: profile.botName }),
  getMeetingBotRecallCreateInput: (profile: {
    botName: string;
    avatarJpegBase64: string | null;
  }) => ({
    botName: profile.botName,
    ...(profile.avatarJpegBase64
      ? { avatarJpegBase64: profile.avatarJpegBase64 }
      : {}),
  }),
  getMeetingBotRecallUpdateInput: (profile: {
    botName: string;
    avatarJpegBase64: string | null;
  }) => ({
    ...(profile.botName === "IOSG Old Friend"
      ? {}
      : { botName: profile.botName }),
    ...(profile.avatarJpegBase64
      ? { avatarJpegBase64: profile.avatarJpegBase64 }
      : {}),
  }),
}));

describe("calendar auto join", () => {
  beforeEach(() => {
    getMeetingBotProfile.mockResolvedValue({
      botName: "IOSG Old Friend",
      avatarJpegBase64: null,
    });
  });

  afterEach(() => {
    deleteRecallCalendarEventBot.mockReset();
    deleteScheduledRecallBot.mockReset();
    getMeetingBotProfile.mockReset();
    insert.mockReset();
    scheduleRecallCalendarEventBot.mockReset();
    scheduleRecallBot.mockReset();
    select.mockReset();
    update.mockReset();
    updateScheduledRecallBot.mockReset();
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

  it("normalizes bare Zoom links from calendar text", async () => {
    const { findCalendarMeetingUrl } = await import("@/lib/calendar-auto-join");

    expect(
      findCalendarMeetingUrl({
        externalEventId: "google_event_123",
        title: "Partner sync",
        startsAt: "2026-06-30T12:00:00.000Z",
        description: "Join Zoom.us/j/8436420171",
      }),
    ).toBe("https://zoom.us/j/8436420171");
  });

  it("ignores physical map URLs in the calendar location", async () => {
    const { findCalendarMeetingUrl } = await import("@/lib/calendar-auto-join");

    expect(
      findCalendarMeetingUrl({
        externalEventId: "google_event_123",
        title: "Office sync",
        startsAt: "2026-06-30T12:00:00.000Z",
        location: "HQ 12F https://maps.google.com/?q=HQ",
      }),
    ).toBeNull();
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
    getMeetingBotProfile.mockResolvedValue({
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });

    const { autoJoinCalendarEvent } = await import("@/lib/calendar-auto-join");

    await expect(
      autoJoinCalendarEvent({
        connection: {
          id: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "55555555-5555-4555-8555-555555555555",
          autoJoinEnabled: true,
          workspaceDomain: "iosg.vc",
        },
        event: {
          externalEventId: "google_event_123",
          title: "Google Meet",
          startsAt: "2026-06-30T12:00:00.000Z",
          endsAt: null,
          attendeeEmails: [
            "founder@nascent.xyz",
            "alice@iosg.vc",
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
        location: null,
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
        title: "IOSG <> Nascent",
      }),
    );
    expect(attendeeValues).toHaveBeenCalledWith([
      {
        email: "founder@nascent.xyz",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
      {
        email: "alice@iosg.vc",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    ]);
    expect(scheduleRecallBot).toHaveBeenCalledWith({
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      metadata: {
        botName: "Deal Scribe",
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

  it("creates an in person meeting reminder when a calendar event has a location and no meeting link", async () => {
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

    const reminderOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const reminderValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: reminderOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([]);

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues })
      .mockReturnValueOnce({ values: reminderValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });

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
          title: "Office visit",
          startsAt: "2026-06-30T12:00:00.000Z",
          endsAt: null,
          attendeeEmails: ["founder@nascent.xyz"],
          location: "IOSG 12F",
        },
      }),
    ).resolves.toEqual({
      action: "scheduled",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      platform: "in_person",
      reminderScheduledFor: "2026-06-30T11:58:00.000Z",
    });

    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "in_person",
        status: "scheduled",
        title: "Office visit",
      }),
    );
    expect(reminderValues).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: "44444444-4444-4444-8444-444444444444",
        userId: "55555555-5555-4555-8555-555555555555",
        status: "pending",
      }),
    );
  });

  it("stores the nested Recall Calendar V2 bot id instead of the calendar event id", async () => {
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

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "scheduled",
        recallBotId: "bot_123",
      }),
    );

    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
      }),
    );
  });

  it("matches Recall Calendar V2 bot responses by the team dedupe key", async () => {
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

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "wrong_bot",
          deduplication_key: "shared_event_123@example.com",
        },
        {
          bot_id: "team_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: "scheduled",
        recallBotId: "team_bot",
      }),
    );
  });

  it("rejects unrelated Recall Calendar V2 bot responses", async () => {
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

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "wrong_bot",
          deduplication_key: "shared_event_123@example.com",
        },
      ],
    });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).rejects.toThrow("Recall bot response missing id");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("links shared Recall calendar events to one team meeting and bot", async () => {
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
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
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
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

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
          externalEventId: "google_event_456",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          recallCalendarEventDeduplicationKey: "vendor-event-copy-key",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
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
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      }),
    );
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "66666666-6666-4666-8666-666666666666",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "bot_123",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      }),
    );
  });

  it("rejects a Recall Calendar V2 bot response without a nested bot id", async () => {
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

    const existingLimit = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: existingLimit,
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      bots: [],
    });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          recallCalendarEventDeduplicationKey: "shared_event_123@example.com",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).rejects.toThrow("Recall bot response missing id");
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
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
      }),
    );
  });

  it("recovers when a concurrent shared event creates the team meeting first", async () => {
    const calendarEventReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const duplicateError = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "meetings_team_meeting_key_unique",
    });
    const meetingReturning = vi.fn().mockRejectedValue(duplicateError);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });

    const initialExistingLimit = vi.fn().mockResolvedValue([]);
    const retryExistingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "99999999-9999-4999-8999-999999999999",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert
      .mockReturnValueOnce({ values: calendarEventValues })
      .mockReturnValueOnce({ values: meetingValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: initialExistingLimit,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: retryExistingLimit,
          }),
        }),
      });
    update.mockReturnValue({ set: updateSet });
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        },
      ],
    });

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
          externalEventId: "google_event_456",
          recallCalendarEventId: "66666666-6666-4666-8666-666666666666",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://meet.google.com/abc-defg-hij",
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
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "66666666-6666-4666-8666-666666666666",
      }),
    );
  });

  it("updates an existing scheduled Recall bot when the calendar link and time change", async () => {
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
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/old-link",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
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
    updateScheduledRecallBot.mockResolvedValue({ id: "bot_123" });

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
          title: "Partner sync moved",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          location: "New room https://meet.google.com/new-link",
        },
      }),
    ).resolves.toEqual({
      action: "updated",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://meet.google.com/new-link",
      platform: "google_meet",
      recallBotId: "bot_123",
    });

    expect(updateScheduledRecallBot).toHaveBeenCalledWith({
      botId: "bot_123",
      meetingUrl: "https://meet.google.com/new-link",
      startAt: "2026-06-30T13:00:00.000Z",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: "https://meet.google.com/new-link",
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        title: "Partner sync moved",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("replaces an existing Recall Calendar V2 bot when the event time changes", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/8166024230",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:30:00.000Z:url:https://zoom.us/j/8166024230",
        recallBotId: "old_bot",
        meetingUrl: "https://zoom.us/j/8166024230",
        startedAt: new Date("2026-06-30T13:30:00.000Z"),
        status: "scheduled",
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
    deleteRecallCalendarEventBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "new_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/8166024230",
        },
      ],
    });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Investment strategy moved",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          meetingUrl: "https://zoom.us/j/8166024230",
        },
      }),
    ).resolves.toEqual({
      action: "updated",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://zoom.us/j/8166024230",
      platform: "zoom",
      recallBotId: "new_bot",
    });

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
      deduplicationKey:
        "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/8166024230",
      botName: "IOSG Old Friend",
      metadata: {
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: "new_bot",
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/8166024230",
      }),
    );
  });

  it("rejects a Recall Calendar V2 replacement response without the new bot id", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:00:00.000Z:url:https://zoom.us/j/8166024230",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:30:00.000Z:url:https://zoom.us/j/8166024230",
        recallBotId: "old_bot",
        meetingUrl: "https://zoom.us/j/8166024230",
        startedAt: new Date("2026-06-30T13:30:00.000Z"),
        status: "scheduled",
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
    deleteRecallCalendarEventBot.mockResolvedValue({});
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "old_bot",
          deduplication_key:
            "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T13:30:00.000Z:url:https://zoom.us/j/8166024230",
        },
      ],
    });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Investment strategy moved",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          meetingUrl: "https://zoom.us/j/8166024230",
        },
      }),
    ).rejects.toThrow("Recall bot response missing id");

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("cancels an existing scheduled Recall bot when the calendar event loses its meeting link", async () => {
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
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/old-link",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
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
    deleteScheduledRecallBot.mockResolvedValue({});

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
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          location: null,
          description: null,
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "missing_meeting_link",
    });

    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({ botId: "bot_123" });
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: null,
        meetingUrl: null,
        startedAt: new Date("2026-06-30T13:00:00.000Z"),
        status: "failed",
        title: "Partner sync",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("marks a deleted scheduled calendar meeting as cancelled", async () => {
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
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/old-link",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Partner sync",
          startsAt: "2026-06-30T13:00:00.000Z",
          endsAt: null,
          isDeleted: true,
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "missing_meeting_link",
    });

    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: null,
        meetingUrl: null,
        status: "cancelled",
        title: "Partner sync",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("keeps a shared team meeting scheduled when one Recall calendar event is deleted", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const activeSiblingLimit = vi.fn().mockResolvedValue([
      {
        id: "77777777-7777-4777-8777-777777777777",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
      },
    ]);

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: existingLimit,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: activeSiblingLimit,
          }),
        }),
      });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          isDeleted: true,
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      reason: "shared_meeting_still_scheduled",
    });

    expect(deleteRecallCalendarEventBot).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("cancels a shared team meeting when remaining sibling events are unsupported", async () => {
    const calendarEventReturning = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
      },
    ]);
    const calendarEventOnConflictDoUpdate = vi
      .fn()
      .mockReturnValue({ returning: calendarEventReturning });
    const calendarEventValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: calendarEventOnConflictDoUpdate });

    const existingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        teamMeetingKey:
          "team:22222222-2222-4222-8222-222222222222:start:2026-06-30T12:00:00.000Z:url:https://meet.google.com/abc-defg-hij",
        recallBotId: "bot_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        startedAt: new Date("2026-06-30T12:00:00.000Z"),
        status: "scheduled",
      },
    ]);
    const unsupportedSiblingLimit = vi.fn().mockResolvedValue([
      {
        id: "77777777-7777-4777-8777-777777777777",
        meetingUrl: "https://example.com/not-a-supported-meeting",
      },
    ]);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    insert.mockReturnValueOnce({ values: calendarEventValues });
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: existingLimit,
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: unsupportedSiblingLimit,
          }),
        }),
      });
    update.mockReturnValue({ set: updateSet });

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
          recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
          title: "Partner sync",
          startsAt: "2026-06-30T12:00:00.000Z",
          meetingUrl: "https://example.com/not-a-supported-meeting",
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingId: "44444444-4444-4444-8444-444444444444",
      meetingUrl: "https://example.com/not-a-supported-meeting",
      reason: "unsupported_meeting_link",
    });

    expect(deleteRecallCalendarEventBot).toHaveBeenCalledWith({
      calendarEventId: "55555555-5555-4555-8555-555555555555",
    });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        recallBotId: null,
        status: "failed",
      }),
    );
  });
});
