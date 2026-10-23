import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  cookies,
  getVerifiedGoogleCalendarEmail,
  exchangeGoogleCalendarCode,
  getCurrentUser,
  getWorkspace,
  storeGoogleCalendarTokens,
  syncRecallCalendarEventsForWorkspace,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  cookies: vi.fn(),
  getVerifiedGoogleCalendarEmail: vi.fn().mockResolvedValue("alice@example.com"),
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
  getVerifiedGoogleCalendarEmail,
  exchangeGoogleCalendarCode,
  GOOGLE_CALENDAR_OAUTH_SETUP_COOKIE: "google-calendar-oauth-return-to-setup",
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE: "google-calendar-oauth-state",
  storeGoogleCalendarTokens,
}));

vi.mock("@/lib/recall-calendar", () => ({
  syncRecallCalendarEventsForWorkspace,
}));

vi.mock("@/lib/organization-workspaces", () => ({
  workspaceForVerifiedCalendarEmail: vi.fn(async (workspace) => workspace),
}));

describe("GET /api/calendar/oauth/callback", () => {
  it("rejects linking after the signed in user changes during Google consent", async () => {
    cookies.mockResolvedValue({ get: () => ({ value: "original-user:state_123" }) });
    getCurrentUser.mockResolvedValue({ id: "different-user", email: "other@example.com", name: null });
    const { GET } = await import("@/app/api/calendar/oauth/callback/route");
    const response = await GET(new Request("https://app.example.com/api/calendar/oauth/callback?code=code&state=state_123"));
    expect(response.headers.get("location")).toContain("calendarError=state_mismatch");
    expect(exchangeGoogleCalendarCode).not.toHaveBeenCalled();
    expect(storeGoogleCalendarTokens).not.toHaveBeenCalled();
  });
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
      get: vi.fn().mockReturnValue({ value: "auth_user_123:state_123" }),
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
      accountEmail: "alice@example.com",
      workspace,
      accessToken: "google-access-token",
      accessTokenExpiresAt: new Date("2026-06-30T12:00:00.000Z"),
      refreshToken: "google-refresh-token",
    });
    expect(syncRecallCalendarEventsForWorkspace).toHaveBeenCalledWith({
      connectionId: "33333333-3333-4333-8333-333333333333",
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
      get: vi.fn().mockReturnValue({ value: "auth_user_123:state_123" }),
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

  it("returns to the setup guide after an OAuth denial", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    cookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "google-calendar-oauth-return-to-setup"
          ? { value: "1" }
          : { value: "auth_user_123:state_123" },
      ),
    });

    const { GET } = await import("@/app/api/calendar/oauth/callback/route");
    const response = await GET(
      new Request(
        "https://app.example.com/api/calendar/oauth/callback?error=access_denied",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/dashboard?calendarError=google_denied&setup=1",
    );
  });

  it("reports an initial calendar event sync failure and keeps setup open", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const workspace = {
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    };

    cookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === "google-calendar-oauth-return-to-setup"
          ? { value: "1" }
          : { value: "auth_user_123:state_123" },
      ),
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
    syncRecallCalendarEventsForWorkspace.mockRejectedValue(
      new Error("Recall sync failed"),
    );

    const { GET } = await import("@/app/api/calendar/oauth/callback/route");
    const response = await GET(
      new Request(
        "https://app.example.com/api/calendar/oauth/callback?code=code_123&state=state_123",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/dashboard?calendarError=sync_failed&syncCalendar=1&setup=1",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "calendar_oauth_initial_sync_failed",
      {
        error: {
          message: "Recall sync failed",
          name: "Error",
        },
        userId: "auth_user_123",
      },
    );
  });
});
