import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  deleteScheduledRecallBot,
  getBotProfileForMeeting,
  getOrCreateWorkspaceForSessionUser,
  returning,
  scheduleRecallBot,
  select,
  send,
  set,
  update,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  deleteScheduledRecallBot: vi.fn(),
  getBotProfileForMeeting: vi.fn(),
  getOrCreateWorkspaceForSessionUser: vi.fn(),
  returning: vi.fn(),
  scheduleRecallBot: vi.fn(),
  select: vi.fn(),
  send: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: { select, update } }));
vi.mock("@/inngest/client", () => ({ inngest: { send } }));
vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
}));
vi.mock("@/lib/meeting-bot-record-profile", () => ({ getBotProfileForMeeting }));
vi.mock("@/lib/meeting-bot-profile", () => ({
  getMeetingBotMetadata: () => ({}),
  getMeetingBotRecallCreateInput: (profile: { botName: string }) => ({
    botName: profile.botName,
  }),
}));
vi.mock("@/lib/vendors/recall", () => ({
  deleteRecallCalendarEventBot: vi.fn(),
  deleteScheduledRecallBot,
  scheduleRecallBot,
}));
vi.mock("@/lib/meeting-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/meeting-links")>();
  return {
    ...actual,
    buildAppUrl: (path: string) => `https://app.example.com${path}`,
    resolveMeetingJoinUrl: async (url: string) => url,
  };
});

const meetingId = "11111111-1111-4111-8111-111111111111";
const sessionUser = { email: "test@iosg.vc", id: "user_123", name: null };
const now = new Date("2026-11-04T12:00:00.000Z");

function mockMeetingRow(row: Record<string, unknown> | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ limit }),
    }),
  });
}

function mockUpdate(rows: { id: string }[]) {
  returning.mockResolvedValue(rows);
  set.mockReturnValue({
    where: vi.fn().mockReturnValue({ returning }),
  });
  update.mockReturnValue({ set });
}

function mockDefaults() {
  getOrCreateWorkspaceForSessionUser.mockResolvedValue({
    teamId: "22222222-2222-4222-8222-222222222222",
    userId: "55555555-5555-4555-8555-555555555555",
  });
  assertCanCreateMeetings.mockResolvedValue(undefined);
  getBotProfileForMeeting.mockResolvedValue({ botName: "Deal Scribe" });
  deleteScheduledRecallBot.mockResolvedValue({});
  send.mockResolvedValue({ ids: ["event"] });
}

async function load() {
  return import("@/lib/meeting-link-replacement");
}

describe("meeting link replacement", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("sends a new bot to the new link and retires the old bot", async () => {
    mockDefaults();
    mockMeetingRow({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      id: meetingId,
      meetingUrl: "https://meet.google.com/old-link-abc",
      recallBotId: "old_bot",
      startedAt: new Date("2026-11-04T11:55:00.000Z"),
    });
    mockUpdate([{ id: meetingId }]);
    scheduleRecallBot.mockResolvedValue({ id: "new_bot" });

    const { replaceMeetingLink } = await load();
    const result = await replaceMeetingLink({
      meetingId,
      meetingUrl: "https://zoom.us/j/123456789",
      now,
      sessionUser,
    });

    expect(result).toMatchObject({
      botId: "new_bot",
      platform: "zoom",
      status: "joining",
    });
    expect(scheduleRecallBot).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: expect.stringContaining("zoom.us/j/123456789"),
        metadata: expect.objectContaining({
          calendarEventId: "33333333-3333-4333-8333-333333333333",
          meetingId,
        }),
      }),
    );
    expect(scheduleRecallBot.mock.calls[0][0]).not.toHaveProperty("startAt");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        botState: null,
        meetingUrlSource: "manual",
        platform: "zoom",
        recallBotId: "new_bot",
        status: "scheduled",
      }),
    );
    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({ botId: "old_bot" });
    expect(deleteScheduledRecallBot).not.toHaveBeenCalledWith({
      botId: "new_bot",
    });
  });

  it("keeps the scheduled join time for a meeting that has not started", async () => {
    mockDefaults();
    mockMeetingRow({
      calendarEventId: null,
      id: meetingId,
      meetingUrl: "https://meet.google.com/old-link-abc",
      recallBotId: "old_bot",
      startedAt: new Date("2026-11-04T15:00:00.000Z"),
    });
    mockUpdate([{ id: meetingId }]);
    scheduleRecallBot.mockResolvedValue({ id: "new_bot" });

    const { replaceMeetingLink } = await load();
    const result = await replaceMeetingLink({
      meetingId,
      meetingUrl: "https://meet.google.com/new-link-xyz",
      now,
      sessionUser,
    });

    expect(result.status).toBe("scheduled");
    expect(scheduleRecallBot).toHaveBeenCalledWith(
      expect.objectContaining({ startAt: "2026-11-04T15:00:00.000Z" }),
    );
  });

  it("retires the new bot when recording began before the swap landed", async () => {
    mockDefaults();
    mockMeetingRow({
      calendarEventId: null,
      id: meetingId,
      meetingUrl: "https://meet.google.com/old-link-abc",
      recallBotId: "old_bot",
      startedAt: null,
    });
    mockUpdate([]);
    scheduleRecallBot.mockResolvedValue({ id: "new_bot" });

    const { MeetingLinkReplacementUnavailableError, replaceMeetingLink } =
      await load();

    await expect(
      replaceMeetingLink({
        meetingId,
        meetingUrl: "https://meet.google.com/new-link-xyz",
        now,
        sessionUser,
      }),
    ).rejects.toBeInstanceOf(MeetingLinkReplacementUnavailableError);
    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({ botId: "new_bot" });
    expect(deleteScheduledRecallBot).not.toHaveBeenCalledWith({
      botId: "old_bot",
    });
  });

  it("rejects meetings that are no longer replaceable", async () => {
    mockDefaults();
    mockMeetingRow(null);

    const { MeetingLinkReplacementUnavailableError, replaceMeetingLink } =
      await load();

    await expect(
      replaceMeetingLink({
        meetingId,
        meetingUrl: "https://meet.google.com/new-link-xyz",
        now,
        sessionUser,
      }),
    ).rejects.toBeInstanceOf(MeetingLinkReplacementUnavailableError);
    expect(scheduleRecallBot).not.toHaveBeenCalled();
  });

  it("rejects links the bot cannot join", async () => {
    mockDefaults();

    const { UnsupportedMeetingLinkError, replaceMeetingLink } = await load();

    await expect(
      replaceMeetingLink({
        meetingId,
        meetingUrl: "https://example.com/meeting",
        now,
        sessionUser,
      }),
    ).rejects.toBeInstanceOf(UnsupportedMeetingLinkError);
    expect(select).not.toHaveBeenCalled();
  });

  it("offers replacement only before anything is recorded", async () => {
    const { canReplaceMeetingLink } = await load();

    expect(
      canReplaceMeetingLink({ platform: "zoom", status: "scheduled" }),
    ).toBe(true);
    expect(
      canReplaceMeetingLink({
        botState: "waiting_room",
        platform: "google_meet",
        status: "recording",
      }),
    ).toBe(true);
    expect(
      canReplaceMeetingLink({ platform: "google_meet", status: "recording" }),
    ).toBe(false);
    expect(
      canReplaceMeetingLink({ platform: "in_person", status: "scheduled" }),
    ).toBe(false);
    expect(canReplaceMeetingLink({ platform: "zoom", status: "ready" })).toBe(
      false,
    );
  });
});
