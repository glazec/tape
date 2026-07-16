import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  cookies,
  exchangeGoogleCalendarCode,
  getCurrentUser,
  getWorkspace,
  storeGoogleCalendarTokens,
  syncRecallCalendarEventsForWorkspace,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  cookies: vi.fn(),
  exchangeGoogleCalendarCode: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  storeGoogleCalendarTokens: vi.fn(),
  syncRecallCalendarEventsForWorkspace: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies,
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/google-calendar-oauth", () => ({
  exchangeGoogleCalendarCode,
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE: "google-calendar-oauth-state",
  storeGoogleCalendarTokens,
}));

vi.mock("@/lib/recall-calendar", () => ({
  syncRecallCalendarEventsForWorkspace,
}));

describe("GET /api/calendar/oauth/callback", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    cookies.mockReset();
    exchangeGoogleCalendarCode.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    storeGoogleCalendarTokens.mockReset();
    syncRecallCalendarEventsForWorkspace.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("stores calendar OAuth tokens and syncs Calendar V2 events", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const workspace = {
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    };

    cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "state_123" }),
    });
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);
    exchangeGoogleCalendarCode.mockResolvedValue({
      accessToken: "google-access-token",
      accessTokenExpiresAt: new Date("2026-06-30T12:00:00.000Z"),
      refreshToken: "google-refresh-token",
    });
    storeGoogleCalendarTokens.mockResolvedValue(
      "33333333-3333-4333-8333-333333333333",
    );
    syncRecallCalendarEventsForWorkspace.mockResolvedValue({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 2,
    });

    const { GET } = await import("@/app/api/calendar/oauth/callback/route");
    const response = await GET(
      new Request(
        "https://app.example.com/api/calendar/oauth/callback?code=code_123&state=state_123",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/dashboard?syncCalendar=1",
    );
    expect(storeGoogleCalendarTokens).toHaveBeenCalledWith({
      workspace,
      accessToken: "google-access-token",
      accessTokenExpiresAt: new Date("2026-06-30T12:00:00.000Z"),
      refreshToken: "google-refresh-token",
    });
    expect(syncRecallCalendarEventsForWorkspace).toHaveBeenCalledWith({
      workspace,
      autoJoinEnabled: true,
    });
  });

  it("logs provider failures before returning the reconnect error", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const workspace = {
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    };

    cookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "state_123" }),
    });
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);
    exchangeGoogleCalendarCode.mockRejectedValue(
      new Error("Google token request failed"),
    );

    const { GET } = await import("@/app/api/calendar/oauth/callback/route");
    const response = await GET(
      new Request(
        "https://app.example.com/api/calendar/oauth/callback?code=code_123&state=state_123",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/dashboard?calendarError=connect_failed",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "calendar_oauth_callback_failed",
      {
        error: {
          message: "Google token request failed",
          name: "Error",
        },
        userId: "auth_user_123",
      },
    );
  });
});
