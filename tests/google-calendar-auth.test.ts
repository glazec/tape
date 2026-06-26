import { describe, expect, it } from "vitest";

describe("Google Calendar auth", () => {
  it("keeps Google sign in focused on identity", async () => {
    const { buildGoogleSignInOptions } =
      await import("@/lib/google-calendar-auth");

    expect(buildGoogleSignInOptions()).toEqual({
      provider: "google",
      callbackURL: "/dashboard",
      errorCallbackURL: "/auth/sign-in",
    });
  });

  it("starts calendar reconnect through the app owned OAuth route", async () => {
    const { connectGoogleCalendar } = await import("@/lib/google-calendar-auth");

    await expect(connectGoogleCalendar()).resolves.toEqual({
      ok: true,
      url: "/api/calendar/oauth/start",
    });
  });
});
