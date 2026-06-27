import { afterEach, describe, expect, it, vi } from "vitest";

const { createRecallCalendar, insert, select, update, updateRecallCalendar } =
  vi.hoisted(() => ({
    createRecallCalendar: vi.fn(),
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

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
  },
}));

vi.mock("@/lib/vendors/recall", () => ({
  createRecallCalendar,
  updateRecallCalendar,
}));

describe("storeGoogleCalendarTokens", () => {
  afterEach(() => {
    createRecallCalendar.mockReset();
    updateRecallCalendar.mockReset();
    insert.mockReset();
    select.mockReset();
    update.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("creates a Recall calendar for a new Google Calendar connection", async () => {
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

  it("backfills a Recall calendar for an existing Google Calendar connection", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "google-client-id");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "google-client-secret");
    createRecallCalendar.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      status: "connecting",
    });
    const updateWhere = vi.fn().mockResolvedValue([]);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "33333333-3333-4333-8333-333333333333",
              oauthAccessToken: null,
              oauthRefreshToken: "google-refresh-token",
              oauthAccessTokenExpiresAt: null,
              recallCalendarId: null,
              recallCalendarStatus: null,
            },
          ]),
        }),
      }),
    });
    update.mockReturnValue({ set: updateSet });

    const { ensureGoogleCalendarRecallCalendar } = await import(
      "@/lib/google-calendar-oauth"
    );

    await expect(
      ensureGoogleCalendarRecallCalendar({
        userId: "11111111-1111-4111-8111-111111111111",
        teamId: "22222222-2222-4222-8222-222222222222",
        domain: "example.com",
      }),
    ).resolves.toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      status: "connecting",
    });

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
    expect(updateSet).toHaveBeenCalledWith({
      recallCalendarId: "44444444-4444-4444-8444-444444444444",
      recallCalendarStatus: "connecting",
      updatedAt: expect.any(Date),
    });
    expect(updateWhere).toHaveBeenCalledOnce();
  });
});
