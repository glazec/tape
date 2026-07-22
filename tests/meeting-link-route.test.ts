import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const getMeetingBotProfile = vi.fn();
const scheduleRecallBot = vi.fn();
const createScheduledMeetingBot = vi.fn();
const findScheduledMeetingBotCalendarCandidates = vi.fn();
const joinScheduledMeetingBotNow = vi.fn();
const markMeetingBotFailed = vi.fn();
const markMeetingBotScheduled = vi.fn();
const findMeetingBotRecoveryCandidates = vi.fn();
const prepareMeetingBotRecovery = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/vendors/recall", () => ({
  scheduleRecallBot,
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
}));

vi.mock("@/lib/meeting-bot-records", () => ({
  createScheduledMeetingBot,
  findScheduledMeetingBotCalendarCandidates,
  markMeetingBotFailed,
  markMeetingBotScheduled,
}));

vi.mock("@/lib/meeting-bot-join", () => ({
  joinScheduledMeetingBotNow,
}));

vi.mock("@/lib/meeting-bot-recovery", () => ({
  findMeetingBotRecoveryCandidates,
  prepareMeetingBotRecovery,
}));

async function postMeetingLink(body: unknown) {
  const { POST } = await import("@/app/api/meetings/link/route");

  return POST(
    new Request("https://app.example.com/api/meetings/link", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
  );
}

describe("POST /api/meetings/link", () => {
  beforeEach(() => {
    findMeetingBotRecoveryCandidates.mockResolvedValue([]);
    findScheduledMeetingBotCalendarCandidates.mockResolvedValue([]);
    getMeetingBotProfile.mockResolvedValue({
      botName: "IOSG Old Friend",
      avatarJpegBase64: null,
    });
  });

  afterEach(() => {
    getCurrentUser.mockReset();
    getMeetingBotProfile.mockReset();
    scheduleRecallBot.mockReset();
    createScheduledMeetingBot.mockReset();
    joinScheduledMeetingBotNow.mockReset();
    markMeetingBotFailed.mockReset();
    markMeetingBotScheduled.mockReset();
    findMeetingBotRecoveryCandidates.mockReset();
    findScheduledMeetingBotCalendarCandidates.mockReset();
    prepareMeetingBotRecovery.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(scheduleRecallBot).not.toHaveBeenCalled();
  });

  it("logs meeting creation failures without exposing the submitted URL", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockRejectedValue(
      new Error('column "title_source" does not exist'),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await postMeetingLink({
      meetingUrl:
        "https://zoom.us/j/86586781346?pwd=sensitive-meeting-password",
    });

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith(
      "meeting_link_scheduling_failure",
      {
        errorMessage: 'column "title_source" does not exist',
        phase: "create_meeting",
        platform: "zoom",
        userId: "user_123",
      },
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "sensitive-meeting-password",
    );

    consoleError.mockRestore();
  });

  it("schedules a Recall bot for Google Meet links", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com\n");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    getMeetingBotProfile.mockResolvedValue({
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });
    markMeetingBotScheduled.mockResolvedValue(undefined);

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      botId: "bot_123",
      meetingId: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      status: "scheduled",
    });
    expect(createScheduledMeetingBot).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
    });
    expect(scheduleRecallBot).toHaveBeenCalledWith({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
      webhookUrl: "https://app.example.com/api/recall/webhook",
      metadata: {
        botName: "Deal Scribe",
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(markMeetingBotScheduled).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "bot_123",
    });
  });

  it("deduplicates a failed calendar meeting before asking to merge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:15:00.000Z"));
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    findScheduledMeetingBotCalendarCandidates.mockResolvedValue([{
      action: "join",
      calendarEventId: "22222222-2222-4222-8222-222222222222",
      endedAt: "2026-07-22T12:30:00.000Z",
      startedAt: "2026-07-22T12:30:00.000Z",
      title: "IOSG <> Greenfield Capital",
    }]);
    findMeetingBotRecoveryCandidates.mockResolvedValue([
      {
        calendarEventId: "22222222-2222-4222-8222-222222222222",
        endedAt: "2026-07-22T12:30:00.000Z",
        id: "11111111-1111-4111-8111-111111111111",
        startedAt: "2026-07-22T12:00:00.000Z",
        title: "IOSG <> Greenfield Capital",
      },
    ]);

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/new-call",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "potential_meetings_detected",
      potentialMeetings: [{
        action: "join",
        endedAt: "2026-07-22T12:30:00.000Z",
        id: "11111111-1111-4111-8111-111111111111",
        kind: "recent",
        startedAt: "2026-07-22T12:00:00.000Z",
        timing: "current",
        title: "IOSG <> Greenfield Capital",
      }],
    });
    expect(createScheduledMeetingBot).not.toHaveBeenCalled();
  });

  it("returns the previous, current, and next meetings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:15:00.000Z"));
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    findScheduledMeetingBotCalendarCandidates.mockResolvedValue([
      {
        action: "schedule",
        calendarEventId: "22222222-2222-4222-8222-222222222222",
        endedAt: "2026-07-22T12:00:00.000Z",
        startedAt: "2026-07-22T11:30:00.000Z",
        title: "Previous meeting",
      },
      {
        action: "join",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        endedAt: "2026-07-22T12:30:00.000Z",
        startedAt: "2026-07-22T12:00:00.000Z",
        title: "Current meeting",
      },
      {
        action: "schedule",
        calendarEventId: "44444444-4444-4444-8444-444444444444",
        endedAt: "2026-07-22T13:00:00.000Z",
        startedAt: "2026-07-22T12:30:00.000Z",
        title: "Next meeting",
      },
    ]);

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/new-call",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "potential_meetings_detected",
      potentialMeetings: [
        { timing: "past", title: "Previous meeting" },
        { timing: "current", title: "Current meeting" },
        { timing: "future", title: "Next meeting" },
      ],
    });
    expect(createScheduledMeetingBot).not.toHaveBeenCalled();
  });

  it("returns a nearby calendar meeting when there is no recent failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:15:00.000Z"));
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    findScheduledMeetingBotCalendarCandidates.mockResolvedValue([{
      action: "schedule",
      calendarEventId: "22222222-2222-4222-8222-222222222222",
      endedAt: "2026-07-22T13:00:00.000Z",
      startedAt: "2026-07-22T12:30:00.000Z",
      title: "IOSG <> Faves",
    }]);

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/new-call",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "potential_meetings_detected",
      potentialMeetings: [{
        action: "schedule",
        endedAt: "2026-07-22T13:00:00.000Z",
        id: "22222222-2222-4222-8222-222222222222",
        kind: "calendar",
        startedAt: "2026-07-22T12:30:00.000Z",
        timing: "future",
        title: "IOSG <> Faves",
      }],
    });
  });

  it("applies a confirmed calendar match", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "existing_bot",
      startAt: "2026-07-22T12:30:00.000Z",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    joinScheduledMeetingBotNow.mockResolvedValue({
      botId: "existing_bot",
      meetingId: "11111111-1111-4111-8111-111111111111",
    });

    const response = await postMeetingLink({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingUrl: "https://meet.google.com/new-call",
    });

    expect(response.status).toBe(200);
    expect(createScheduledMeetingBot).toHaveBeenCalledWith({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingUrl: "https://meet.google.com/new-call",
      platform: "google_meet",
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
    });
    expect(findScheduledMeetingBotCalendarCandidates).not.toHaveBeenCalled();
  });

  it("creates a separate meeting without calendar matching", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    scheduleRecallBot.mockResolvedValue({ id: "new_bot" });

    const response = await postMeetingLink({
      createSeparateMeeting: true,
      meetingUrl: "https://meet.google.com/new-call",
    });

    expect(response.status).toBe(200);
    expect(createScheduledMeetingBot).toHaveBeenCalledWith({
      meetingUrl: "https://meet.google.com/new-call",
      platform: "google_meet",
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      skipCalendarMatch: true,
    });
  });

  it("records a confirmed replacement link under the current meeting", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    prepareMeetingBotRecovery.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    scheduleRecallBot.mockResolvedValue({ id: "replacement_bot" });

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/new-call",
      recoveryMeetingId: "11111111-1111-4111-8111-111111111111",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      meetingId: "11111111-1111-4111-8111-111111111111",
      status: "joining",
    });
    expect(prepareMeetingBotRecovery).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      meetingUrl: "https://meet.google.com/new-call",
      platform: "google_meet",
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
    });
    expect(createScheduledMeetingBot).not.toHaveBeenCalled();
  });

  it("schedules a Recall bot for Zoom links", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_456" });
    markMeetingBotScheduled.mockResolvedValue(undefined);

    const response = await postMeetingLink({
      meetingUrl: "https://zoom.us/j/123456789",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      botId: "bot_456",
      meetingId: "22222222-2222-4222-8222-222222222222",
      platform: "zoom",
      status: "scheduled",
    });
  });

  it("schedules a Recall bot for Zoom personal room links", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://iosg-vc.zoom.us/j/1234567890?pwd=ZmFrZS1wYXNzd29yZA&_x_zm_rtaid=tracking",
          },
        }),
      ),
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_456" });
    markMeetingBotScheduled.mockResolvedValue(undefined);

    const meetingUrl =
      "https://iosg-vc.zoom.us/my/test?pwd=ZmFrZS1wYXNzd29yZA";
    const canonicalMeetingUrl =
      "https://zoom.us/j/1234567890?pwd=ZmFrZS1wYXNzd29yZA";
    const response = await postMeetingLink({ meetingUrl });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      botId: "bot_456",
      meetingId: "22222222-2222-4222-8222-222222222222",
      meetingUrl: canonicalMeetingUrl,
      platform: "zoom",
      status: "scheduled",
    });
    expect(createScheduledMeetingBot).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      meetingUrl: canonicalMeetingUrl,
      platform: "zoom",
    });
  });

  it("passes a matched calendar start time to Recall scheduling", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      teamId: "22222222-2222-4222-8222-222222222222",
      startAt: "2026-07-02T02:00:00.000Z",
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_456" });
    markMeetingBotScheduled.mockResolvedValue(undefined);

    const meetingUrl = "https://zoom.us/j/8851797582";
    const response = await postMeetingLink({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingUrl,
    });

    expect(response.status).toBe(200);
    expect(scheduleRecallBot).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl,
        startAt: "2026-07-02T02:00:00.000Z",
      }),
    );
  });

  it("asks an existing scheduled calendar bot to join now", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      teamId: "22222222-2222-4222-8222-222222222222",
      startAt: "2026-07-02T02:00:00.000Z",
      recallBotId: "existing_bot",
    });
    joinScheduledMeetingBotNow.mockResolvedValue({
      botId: "adhoc_bot",
      meetingId: "22222222-2222-4222-8222-222222222222",
    });

    const meetingUrl = "https://zoom.us/j/8851797582";
    const response = await postMeetingLink({
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      meetingUrl,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      botId: "adhoc_bot",
      meetingId: "22222222-2222-4222-8222-222222222222",
      meetingUrl,
      platform: "zoom",
      status: "joining",
    });
    expect(joinScheduledMeetingBotNow).toHaveBeenCalledWith({
      meetingId: "22222222-2222-4222-8222-222222222222",
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
    });
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(markMeetingBotScheduled).not.toHaveBeenCalled();
  });

  it("rejects unsupported meeting links", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await postMeetingLink({
      meetingUrl: "https://example.com/meeting",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported meeting link",
    });
    expect(scheduleRecallBot).not.toHaveBeenCalled();
    expect(createScheduledMeetingBot).not.toHaveBeenCalled();
  });

  it("returns 502 when Recall scheduling fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    createScheduledMeetingBot.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    scheduleRecallBot.mockRejectedValue(new Error("Recall unavailable"));
    markMeetingBotFailed.mockResolvedValue(undefined);

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Meeting bot unavailable",
    });
    expect(markMeetingBotFailed).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
  });
});
