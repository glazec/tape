import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit: vi.fn(),
}));

const {
  assertCanCreateMeetings,
  deleteScheduledRecallBot,
  getMeetingBotProfile,
  getOrCreateWorkspaceForSessionUser,
  listRecallCalendarEvents,
  markMeetingBotScheduled,
  scheduleRecallBot,
  scheduleRecallCalendarEventBot,
  send,
  select,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  deleteScheduledRecallBot: vi.fn(),
  getMeetingBotProfile: vi.fn(),
  getOrCreateWorkspaceForSessionUser: vi.fn(),
  listRecallCalendarEvents: vi.fn(),
  markMeetingBotScheduled: vi.fn(),
  scheduleRecallBot: vi.fn(),
  scheduleRecallCalendarEventBot: vi.fn(),
  send: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: { select } }));

vi.mock("@/inngest/client", () => ({
  inngest: { send },
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
}));

vi.mock("@/lib/meeting-bot-records", () => ({ markMeetingBotScheduled }));

vi.mock("@/lib/meeting-links", () => ({
  buildAppUrl: (path: string) => `https://app.example.com${path}`,
}));

vi.mock("@/lib/meeting-bot-profile", () => ({
  getMeetingBotProfile,
  getMeetingBotMetadata: (profile: { botName: string }) =>
    profile.botName === "IOSG Old Friend" ? {} : { botName: profile.botName },
  getMeetingBotRecallCreateInput: (profile: {
    avatarJpegBase64: string | null;
    botName: string;
  }) => ({
    botName: profile.botName,
    ...(profile.avatarJpegBase64
      ? { avatarJpegBase64: profile.avatarJpegBase64 }
      : {}),
  }),
}));

vi.mock("@/lib/vendors/recall", () => ({
  deleteScheduledRecallBot,
  listRecallCalendarEvents,
  scheduleRecallBot,
  scheduleRecallCalendarEventBot,
}));

function mockMeetingRow(row: Record<string, unknown> | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const chain = {
    leftJoin: vi.fn(),
    where: vi.fn().mockReturnValue({ limit }),
  };
  chain.leftJoin.mockReturnValue(chain);
  select.mockReturnValue({ from: vi.fn().mockReturnValue(chain) });
}

function mockWorkspace() {
  getOrCreateWorkspaceForSessionUser.mockResolvedValue({
    canCreateMeetings: true,
    domain: "iosg.vc",
    teamId: "22222222-2222-4222-8222-222222222222",
    userId: "55555555-5555-4555-8555-555555555555",
  });
  assertCanCreateMeetings.mockResolvedValue(undefined);
  getMeetingBotProfile.mockResolvedValue({
    avatarJpegBase64: "custom-avatar",
    botName: "Deal Scribe",
  });
}

const sessionUser = {
  email: "test@iosg.vc",
  id: "user_123",
  name: null,
};

describe("meeting bot early join", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    deleteScheduledRecallBot.mockReset();
    getMeetingBotProfile.mockReset();
    getOrCreateWorkspaceForSessionUser.mockReset();
    listRecallCalendarEvents.mockReset();
    markMeetingBotScheduled.mockReset();
    scheduleRecallBot.mockReset();
    scheduleRecallCalendarEventBot.mockReset();
    send.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("replaces a direct scheduled bot with an ad hoc bot", async () => {
    mockWorkspace();
    mockMeetingRow({
      calendarEventId: null,
      externalCalendarEventId: null,
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: null,
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: null,
    });
    deleteScheduledRecallBot.mockResolvedValue({});
    scheduleRecallBot.mockResolvedValue({ id: "adhoc_bot" });
    markMeetingBotScheduled.mockResolvedValue(undefined);
    send.mockResolvedValue({ ids: ["delete_event"] });

    const { joinScheduledMeetingBotNow } =
      await import("@/lib/meeting-bot-join");

    await expect(
      joinScheduledMeetingBotNow({
        meetingId: "11111111-1111-4111-8111-111111111111",
        sessionUser,
      }),
    ).resolves.toEqual({
      botId: "adhoc_bot",
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({
      botId: "scheduled_bot",
    });
    expect(scheduleRecallBot).toHaveBeenCalledWith({
      avatarJpegBase64: "custom-avatar",
      botName: "Deal Scribe",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      metadata: {
        botName: "Deal Scribe",
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });
    expect(markMeetingBotScheduled).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "adhoc_bot",
    });
    expect(scheduleRecallBot.mock.invocationCallOrder[0]).toBeLessThan(
      markMeetingBotScheduled.mock.invocationCallOrder[0],
    );
    expect(markMeetingBotScheduled.mock.invocationCallOrder[0]).toBeLessThan(
      deleteScheduledRecallBot.mock.invocationCallOrder[0],
    );
    expect(send).toHaveBeenCalledWith({
      id: "delete-recall-bot:scheduled_bot",
      name: "meeting/delete.recall-bot",
      data: { botId: "scheduled_bot" },
    });
  });

  it("overrides the Calendar V2 bot join time through its calendar event", async () => {
    mockWorkspace();
    mockMeetingRow({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      externalCalendarEventId: "google_event_123",
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: "calendar_123",
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: "shared_event_key",
    });
    listRecallCalendarEvents.mockResolvedValue([
      { id: "recall_event_123", platform_id: "google_event_123" },
    ]);
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "adhoc_calendar_bot",
          deduplication_key: "shared_event_key",
        },
      ],
    });
    markMeetingBotScheduled.mockResolvedValue(undefined);
    send.mockResolvedValue({ ids: ["delete_event"] });

    const { joinScheduledMeetingBotNow } =
      await import("@/lib/meeting-bot-join");

    await expect(
      joinScheduledMeetingBotNow({
        meetingId: "11111111-1111-4111-8111-111111111111",
        now: new Date("2026-07-16T15:30:00.000Z"),
        sessionUser,
      }),
    ).resolves.toEqual({
      botId: "adhoc_calendar_bot",
      meetingId: "11111111-1111-4111-8111-111111111111",
    });

    expect(listRecallCalendarEvents).toHaveBeenCalledWith({
      calendarId: "calendar_123",
      startTimeGte: "2026-07-16T16:00:00.000Z",
    });
    expect(scheduleRecallCalendarEventBot).toHaveBeenCalledWith({
      avatarJpegBase64: "custom-avatar",
      botName: "Deal Scribe",
      calendarEventId: "recall_event_123",
      deduplicationKey: "shared_event_key",
      joinAt: "2026-07-16T15:30:10.000Z",
      metadata: {
        botName: "Deal Scribe",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({
      botId: "scheduled_bot",
    });
    expect(markMeetingBotScheduled).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "adhoc_calendar_bot",
    });
    expect(
      scheduleRecallCalendarEventBot.mock.invocationCallOrder[0],
    ).toBeLessThan(markMeetingBotScheduled.mock.invocationCallOrder[0]);
    expect(markMeetingBotScheduled.mock.invocationCallOrder[0]).toBeLessThan(
      deleteScheduledRecallBot.mock.invocationCallOrder[0],
    );
    expect(send).toHaveBeenCalledWith({
      id: "delete-recall-bot:scheduled_bot",
      name: "meeting/delete.recall-bot",
      data: { botId: "scheduled_bot" },
    });
  });

  it("succeeds when direct deletion fails after a durable retry is queued", async () => {
    mockWorkspace();
    mockMeetingRow({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      externalCalendarEventId: "google_event_123",
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: "calendar_123",
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: "shared_event_key",
    });
    listRecallCalendarEvents.mockResolvedValue([
      { id: "recall_event_123", platform_id: "google_event_123" },
    ]);
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "adhoc_calendar_bot",
          deduplication_key: "shared_event_key",
        },
      ],
    });
    markMeetingBotScheduled.mockResolvedValue(undefined);
    send.mockResolvedValue({ ids: ["delete_event"] });
    deleteScheduledRecallBot.mockRejectedValue(
      new Error("Recall temporarily unavailable"),
    );

    const { joinScheduledMeetingBotNow } =
      await import("@/lib/meeting-bot-join");

    await expect(
      joinScheduledMeetingBotNow({
        meetingId: "11111111-1111-4111-8111-111111111111",
        sessionUser,
      }),
    ).resolves.toEqual({
      botId: "adhoc_calendar_bot",
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(send).toHaveBeenCalledWith({
      id: "delete-recall-bot:scheduled_bot",
      name: "meeting/delete.recall-bot",
      data: { botId: "scheduled_bot" },
    });
  });

  it("removes the new Calendar V2 bot when activation fails", async () => {
    mockWorkspace();
    mockMeetingRow({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      externalCalendarEventId: "google_event_123",
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: "calendar_123",
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: "shared_event_key",
    });
    listRecallCalendarEvents.mockResolvedValue([
      { id: "recall_event_123", platform_id: "google_event_123" },
    ]);
    scheduleRecallCalendarEventBot.mockResolvedValue({
      bots: [
        {
          bot_id: "adhoc_calendar_bot",
          deduplication_key: "shared_event_key",
        },
      ],
    });
    markMeetingBotScheduled.mockRejectedValue(
      new Error("database unavailable"),
    );
    deleteScheduledRecallBot.mockResolvedValue({});

    const { joinScheduledMeetingBotNow } =
      await import("@/lib/meeting-bot-join");

    await expect(
      joinScheduledMeetingBotNow({
        meetingId: "11111111-1111-4111-8111-111111111111",
        sessionUser,
      }),
    ).rejects.toThrow("database unavailable");
    expect(deleteScheduledRecallBot).toHaveBeenCalledExactlyOnceWith({
      botId: "adhoc_calendar_bot",
    });
  });

  it("rejects a Calendar V2 response that does not identify the new bot", async () => {
    mockWorkspace();
    mockMeetingRow({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      externalCalendarEventId: "google_event_123",
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: "calendar_123",
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: "shared_event_key",
    });
    listRecallCalendarEvents.mockResolvedValue([
      { id: "recall_event_123", platform_id: "google_event_123" },
    ]);
    scheduleRecallCalendarEventBot.mockResolvedValue({ bots: [] });

    const { joinScheduledMeetingBotNow } =
      await import("@/lib/meeting-bot-join");

    await expect(
      joinScheduledMeetingBotNow({
        meetingId: "11111111-1111-4111-8111-111111111111",
        sessionUser,
      }),
    ).rejects.toThrow("Recall calendar bot response missing id");
    expect(markMeetingBotScheduled).not.toHaveBeenCalled();
    expect(deleteScheduledRecallBot).not.toHaveBeenCalled();
  });

  it("removes the new direct bot when activation fails", async () => {
    mockWorkspace();
    mockMeetingRow({
      calendarEventId: null,
      externalCalendarEventId: null,
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: null,
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: null,
    });
    scheduleRecallBot.mockResolvedValue({ id: "adhoc_bot" });
    markMeetingBotScheduled.mockRejectedValue(
      new Error("database unavailable"),
    );
    deleteScheduledRecallBot.mockResolvedValue({});

    const { joinScheduledMeetingBotNow } =
      await import("@/lib/meeting-bot-join");

    await expect(
      joinScheduledMeetingBotNow({
        meetingId: "11111111-1111-4111-8111-111111111111",
        sessionUser,
      }),
    ).rejects.toThrow("database unavailable");
    expect(deleteScheduledRecallBot).toHaveBeenCalledExactlyOnceWith({
      botId: "adhoc_bot",
    });
  });

  it("rejects a meeting that no longer has a scheduled bot", async () => {
    mockWorkspace();
    mockMeetingRow(null);

    const { MeetingBotJoinUnavailableError, joinScheduledMeetingBotNow } =
      await import("@/lib/meeting-bot-join");

    await expect(
      joinScheduledMeetingBotNow({
        meetingId: "11111111-1111-4111-8111-111111111111",
        sessionUser,
      }),
    ).rejects.toBeInstanceOf(MeetingBotJoinUnavailableError);
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(scheduleRecallCalendarEventBot).not.toHaveBeenCalled();
  });
});
