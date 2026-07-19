import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createRecallCalendar,
  deleteRecallCalendar,
  insert,
  select,
  update,
  updateRecallCalendar,
} = vi.hoisted(() => ({
  createRecallCalendar: vi.fn(),
  deleteRecallCalendar: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  updateRecallCalendar: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
    update,
  },
}));

vi.mock("@/lib/auth-config", () => ({
  getNeonAuthCookieSecret: () => "test-cookie-secret",
}));

vi.mock("@/lib/vendors/recall", () => ({
  createRecallCalendar,
  deleteRecallCalendar,
  updateRecallCalendar,
}));

describe("Google Calendar OAuth storage", () => {
  afterEach(() => {
    createRecallCalendar.mockReset();
    deleteRecallCalendar.mockReset();
    updateRecallCalendar.mockReset();
    insert.mockReset();
    select.mockReset();
    update.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not inherit unrelated scopes previously granted to the OAuth client", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "google-client-secret");

    const { buildGoogleCalendarOAuthUrl } = await import(
      "@/lib/google-calendar-oauth"
    );
    const url = new URL(buildGoogleCalendarOAuthUrl("oauth-state"));

    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ]);
  });

  it("creates a Calendar V2 connection for a new Google calendar connection", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "google-client-secret");
    createRecallCalendar.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      status: "connecting",
    });
    const insertReturning = vi
      .fn()
      .mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333" }]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });

    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    insert.mockReturnValue({ values: insertValues });

    const { storeGoogleCalendarTokens } = await import(
      "@/lib/google-calendar-oauth"
    );

    await expect(
      storeGoogleCalendarTokens({
        workspace: {
          userId: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "example.com",
        },
        accessToken: "google-access-token",
        accessTokenExpiresAt: new Date("2026-06-30T12:00:00.000Z"),
        refreshToken: "google-refresh-token",
      }),
    ).resolves.toBe("33333333-3333-4333-8333-333333333333");

    expect(createRecallCalendar).toHaveBeenCalledWith({
      oauthClientId: "google-client-id",
      oauthClientSecret: "google-client-secret",
      oauthRefreshToken: "google-refresh-token",
      platform: "google_calendar",
      metadata: {
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
      },
    });
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        recallCalendarId: "44444444-4444-4444-8444-444444444444",
        recallCalendarStatus: "connecting",
      }),
    );
  });

  it("deletes the Recall calendar and clears stored credentials on disconnect", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "33333333-3333-4333-8333-333333333333",
              oauthRefreshToken: "encrypted-refresh-token",
              recallCalendarId: "44444444-4444-4444-8444-444444444444",
              recallCalendarStatus: "connected",
            },
          ]),
        }),
      }),
    });
    deleteRecallCalendar.mockResolvedValue({});
    update.mockReturnValue({ set: updateSet });

    const { disconnectGoogleCalendarForWorkspace } = await import(
      "@/lib/google-calendar-oauth"
    );

    await expect(
      disconnectGoogleCalendarForWorkspace({
        userId: "11111111-1111-4111-8111-111111111111",
        teamId: "22222222-2222-4222-8222-222222222222",
        domain: "example.com",
      }),
    ).resolves.toBe(true);

    expect(deleteRecallCalendar).toHaveBeenCalledWith({
      calendarId: "44444444-4444-4444-8444-444444444444",
    });
    expect(updateSet).toHaveBeenCalledWith({
      autoJoinEnabled: false,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      oauthAccessTokenExpiresAt: null,
      recallCalendarId: null,
      recallCalendarStatus: null,
      recallCalendarLastSyncedAt: null,
      updatedAt: expect.any(Date),
    });
  });
});
