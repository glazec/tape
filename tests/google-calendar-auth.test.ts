import { describe, expect, it, vi } from "vitest";

describe("Google Calendar auth", () => {
  it("requests read access to calendar events during Google sign in", async () => {
    const { GOOGLE_CALENDAR_EVENT_READ_SCOPE, buildGoogleSignInOptions } =
      await import("@/lib/google-calendar-auth");

    expect(buildGoogleSignInOptions()).toEqual({
      provider: "google",
      callbackURL: "/dashboard",
      errorCallbackURL: "/auth/sign-in",
      scopes: [GOOGLE_CALENDAR_EVENT_READ_SCOPE],
    });
  });

  it("builds a calendar reconnect flow for existing signed in users", async () => {
    const {
      GOOGLE_CALENDAR_EVENT_READ_SCOPE,
      buildGoogleCalendarReconnectOptions,
    } =
      await import("@/lib/google-calendar-auth");

    expect(buildGoogleCalendarReconnectOptions()).toEqual({
      provider: "google",
      callbackURL: "/dashboard?syncCalendar=1",
      errorCallbackURL: "/dashboard",
      scopes: [GOOGLE_CALENDAR_EVENT_READ_SCOPE],
    });
  });

  it("starts calendar reconnect through the Google sign in endpoint", async () => {
    const signInSocial = vi.fn().mockResolvedValue({
      data: { redirect: true, url: "https://accounts.google.com/o/oauth2/v2/auth" },
      error: null,
    });
    const { connectGoogleCalendar, buildGoogleCalendarReconnectOptions } =
      await import("@/lib/google-calendar-auth");

    await expect(
      connectGoogleCalendar({
        signIn: {
          social: signInSocial,
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(signInSocial).toHaveBeenCalledWith(
      buildGoogleCalendarReconnectOptions(),
    );
  });
});
