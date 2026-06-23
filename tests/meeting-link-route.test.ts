import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const scheduleRecallBot = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/vendors/recall", () => ({
  scheduleRecallBot,
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
  afterEach(() => {
    getCurrentUser.mockReset();
    scheduleRecallBot.mockReset();
    vi.unstubAllEnvs();
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

  it("schedules a Recall bot for Google Meet links", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      botId: "bot_123",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      platform: "google_meet",
      status: "scheduled",
    });
    expect(scheduleRecallBot).toHaveBeenCalledWith({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });
  });

  it("schedules a Recall bot for Zoom links", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com/");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    scheduleRecallBot.mockResolvedValue({ id: "bot_456" });

    const response = await postMeetingLink({
      meetingUrl: "https://zoom.us/j/123456789",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      botId: "bot_456",
      platform: "zoom",
      status: "scheduled",
    });
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
  });

  it("returns 502 when Recall scheduling fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    scheduleRecallBot.mockRejectedValue(new Error("Recall unavailable"));

    const response = await postMeetingLink({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Meeting bot unavailable",
    });
  });
});
