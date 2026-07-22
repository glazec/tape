import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  createScheduledMeetingBot,
  findMeetingBotRecoveryCandidate,
  getCurrentUser,
  getMeetingBotProfile,
  getOrCreateWorkspaceForSessionUser,
  markMeetingBotFailed,
  markMeetingBotScheduled,
  select,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  createScheduledMeetingBot: vi.fn(),
  findMeetingBotRecoveryCandidate: vi.fn(),
  getCurrentUser: vi.fn(),
  getMeetingBotProfile: vi.fn(),
  getOrCreateWorkspaceForSessionUser: vi.fn(),
  markMeetingBotFailed: vi.fn(),
  markMeetingBotScheduled: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));

vi.mock("@/db/client", () => ({ db: { select } }));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
}));

vi.mock("@/lib/meeting-bot-records", () => ({
  createScheduledMeetingBot,
  markMeetingBotFailed,
  markMeetingBotScheduled,
}));

vi.mock("@/lib/meeting-bot-recovery", () => ({
  findMeetingBotRecoveryCandidate,
  prepareMeetingBotRecovery: vi.fn(),
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

function mockScheduledCalendarMeeting() {
  const limit = vi.fn().mockResolvedValue([
    {
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      externalCalendarEventId: "google_event_123",
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: "calendar_123",
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: "shared_event_key",
    },
  ]);
  const chain = {
    leftJoin: vi.fn(),
    where: vi.fn().mockReturnValue({ limit }),
  };
  chain.leftJoin.mockReturnValue(chain);
  select.mockReturnValue({ from: vi.fn().mockReturnValue(chain) });
}

function mockDirectScheduledMeeting() {
  const limit = vi.fn().mockResolvedValue([
    {
      calendarEventId: null,
      externalCalendarEventId: null,
      id: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallBotId: "scheduled_bot",
      recallCalendarId: null,
      startedAt: new Date("2026-07-16T17:00:00.000Z"),
      teamId: "22222222-2222-4222-8222-222222222222",
      teamMeetingKey: null,
    },
  ]);
  const chain = {
    leftJoin: vi.fn(),
    where: vi.fn().mockReturnValue({ limit }),
  };
  chain.leftJoin.mockReturnValue(chain);
  select.mockReturnValue({ from: vi.fn().mockReturnValue(chain) });
}

describe("New Meeting existing URL early join", () => {
  beforeEach(() => {
    findMeetingBotRecoveryCandidate.mockResolvedValue(null);
  });

  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    createScheduledMeetingBot.mockReset();
    findMeetingBotRecoveryCandidate.mockReset();
    getCurrentUser.mockReset();
    getMeetingBotProfile.mockReset();
    getOrCreateWorkspaceForSessionUser.mockReset();
    markMeetingBotFailed.mockReset();
    markMeetingBotScheduled.mockReset();
    select.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("dispatches the existing Calendar V2 bot instead of only returning success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T15:30:00.000Z"));
    vi.stubEnv("ELEVENLABS_API_KEY", "elevenlabs-key");
    vi.stubEnv("RECALL_API_KEY", "recall-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const user = {
      email: "test@iosg.vc",
      id: "user_123",
      name: null,
    };
    getCurrentUser.mockResolvedValue(user);
    getOrCreateWorkspaceForSessionUser.mockResolvedValue({
      canCreateMeetings: true,
      domain: "iosg.vc",
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "scheduled_bot",
      startAt: "2026-07-16T17:00:00.000Z",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    getMeetingBotProfile.mockResolvedValue({
      avatarJpegBase64: null,
      botName: "IOSG Old Friend",
    });
    mockScheduledCalendarMeeting();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") {
        return Response.json({
          next: null,
          results: [
            { id: "recall_event_123", platform_id: "google_event_123" },
          ],
        });
      }

      return Response.json({
        bots: [
          {
            bot_id: "immediate_bot",
            deduplication_key: "shared_event_key",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/meetings/link/route");
    const response = await POST(
      new Request("https://app.example.com/api/meetings/link", {
        body: JSON.stringify({
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      botId: "immediate_bot",
      meetingId: "11111111-1111-4111-8111-111111111111",
      status: "joining",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/v2/calendar-events/?calendar_id=calendar_123",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://us-east-1.recall.ai/api/v2/calendar-events/recall_event_123/bot/",
    );
    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    ) as {
      bot_config: { join_at?: string };
      deduplication_key: string;
    };
    expect(requestBody).toMatchObject({
      bot_config: { join_at: "2026-07-16T15:30:10.000Z" },
      deduplication_key: "shared_event_key",
    });
    expect(markMeetingBotScheduled).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "immediate_bot",
    });
  });

  it("replaces an existing direct scheduled bot with an immediate bot", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "elevenlabs-key");
    vi.stubEnv("RECALL_API_KEY", "recall-key");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const user = {
      email: "test@iosg.vc",
      id: "user_123",
      name: null,
    };
    getCurrentUser.mockResolvedValue(user);
    getOrCreateWorkspaceForSessionUser.mockResolvedValue({
      canCreateMeetings: true,
      domain: "iosg.vc",
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "scheduled_bot",
      startAt: "2026-07-16T17:00:00.000Z",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    getMeetingBotProfile.mockResolvedValue({
      avatarJpegBase64: null,
      botName: "IOSG Old Friend",
    });
    mockDirectScheduledMeeting();

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return Response.json({ id: "immediate_bot" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("@/app/api/meetings/link/route");
    const response = await POST(
      new Request("https://app.example.com/api/meetings/link", {
        body: JSON.stringify({
          meetingUrl: "https://meet.google.com/abc-defg-hij",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      botId: "immediate_bot",
      status: "joining",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual([
      "https://us-east-1.recall.ai/api/v1/bot/scheduled_bot/",
      expect.objectContaining({ method: "DELETE" }),
    ]);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://us-east-1.recall.ai/api/v1/bot/",
    );
    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    ) as { join_at?: string; meeting_url: string };
    expect(requestBody).toMatchObject({
      meeting_url: "https://meet.google.com/abc-defg-hij",
    });
    expect(requestBody).not.toHaveProperty("join_at");
    expect(markMeetingBotScheduled).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "immediate_bot",
    });
  });
});
