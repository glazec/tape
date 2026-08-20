import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  buildGoogleCalendarOAuthUrl,
  getCurrentUser,
  getWorkspace,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  buildGoogleCalendarOAuthUrl: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/google-calendar-oauth", () => ({
  buildGoogleCalendarOAuthUrl,
  GOOGLE_CALENDAR_OAUTH_SETUP_COOKIE: "google-calendar-oauth-return-to-setup",
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE: "google-calendar-oauth-state",
  shouldUseSecureCalendarOAuthCookie: () => false,
}));

describe("GET /api/calendar/oauth/start", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    buildGoogleCalendarOAuthUrl.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("starts calendar OAuth for users who can create meetings", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    buildGoogleCalendarOAuthUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?state=state_123",
    );

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new Request("https://app.example.com/api/calendar/oauth/start"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=state_123",
    );
    expect(buildGoogleCalendarOAuthUrl).toHaveBeenCalledWith(expect.any(String));
  });

  it("remembers when OAuth started from the setup guide", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    buildGoogleCalendarOAuthUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?state=state_123",
    );

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new Request(
        "https://app.example.com/api/calendar/oauth/start?setup=1",
      ),
    );

    expect(
      response.cookies.get("google-calendar-oauth-return-to-setup")?.value,
    ).toBe("1");
  });

  it("returns a useful setup error when Google OAuth is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "alice@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    buildGoogleCalendarOAuthUrl.mockImplementation(() => {
      throw new Error("Google Calendar OAuth configuration is missing");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new Request(
        "https://app.example.com/api/calendar/oauth/start?setup=1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/dashboard?calendarError=connect_failed&setup=1",
    );
    expect(consoleError).toHaveBeenCalledWith("calendar_oauth_start_failed", {
      error: {
        message: "Google Calendar OAuth configuration is missing",
        name: "Error",
      },
      userId: "auth_user_123",
    });
    expect(
      response.cookies.get("google-calendar-oauth-state"),
    ).toBeUndefined();
  });

  it("does not start calendar OAuth for shared only users", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const { SharedOnlyAccessError } = await import("@/lib/access-errors");

    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "reader@partner.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
      domain: "partner.com",
      canCreateMeetings: false,
    });
    assertCanCreateMeetings.mockRejectedValue(new SharedOnlyAccessError());

    const { GET } = await import("@/app/api/calendar/oauth/start/route");
    const response = await GET(
      new Request("https://app.example.com/api/calendar/oauth/start"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/dashboard",
    );
    expect(buildGoogleCalendarOAuthUrl).not.toHaveBeenCalled();
  });
});
