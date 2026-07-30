import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  buildPricingCalendarOAuthUrl,
  exchangePricingCalendarCode,
  isPricingCalendarConfigured,
} = vi.hoisted(() => ({
  buildPricingCalendarOAuthUrl: vi.fn(),
  exchangePricingCalendarCode: vi.fn(),
  isPricingCalendarConfigured: vi.fn(),
}));

vi.mock("@/lib/pricing-calendar-oauth", () => ({
  buildPricingCalendarOAuthUrl,
  exchangePricingCalendarCode,
  isPricingCalendarConfigured,
  encryptPricingCalendarToken: (token: string) => `encrypted:${token}`,
  getPricingCalendarAppUrl: () => "https://app.example.com",
  shouldUseSecurePricingCalendarCookie: () => false,
  PRICING_CALENDAR_COOKIE_PATH: "/api/pricing-calendar",
  PRICING_CALENDAR_STATE_COOKIE: "tape-pricing-calendar-state",
  PRICING_CALENDAR_STATE_MAX_AGE_SECONDS: 600,
  PRICING_CALENDAR_TOKEN_COOKIE: "tape-pricing-calendar-token",
  PRICING_CALENDAR_TOKEN_COOKIE_PATH: "/",
  PRICING_CALENDAR_TOKEN_MAX_AGE_SECONDS: 300,
}));

function requestWithCookies(url: string, cookies: Record<string, string> = {}) {
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  // The route reads request.cookies, which only NextRequest provides.
  return new NextRequest(url, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

afterEach(() => {
  buildPricingCalendarOAuthUrl.mockReset();
  exchangePricingCalendarCode.mockReset();
  isPricingCalendarConfigured.mockReset();
  vi.resetModules();
});

describe("GET /api/pricing-calendar/start", () => {
  it("sends an anonymous visitor to Google with a state cookie", async () => {
    isPricingCalendarConfigured.mockReturnValue(true);
    buildPricingCalendarOAuthUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
    );

    const { GET } = await import("@/app/api/pricing-calendar/start/route");
    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
    );

    const state = response.cookies.get("tape-pricing-calendar-state");
    expect(state?.value).toBeTruthy();
    expect(state?.httpOnly).toBe(true);
    // The state cookie is passed straight into the authorize URL.
    expect(buildPricingCalendarOAuthUrl).toHaveBeenCalledWith(state?.value);
  });

  it("bounces back to the pricing section when Google is not configured", async () => {
    isPricingCalendarConfigured.mockReturnValue(false);

    const { GET } = await import("@/app/api/pricing-calendar/start/route");
    const response = await GET();

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?calendar=unavailable#pricing",
    );
    expect(buildPricingCalendarOAuthUrl).not.toHaveBeenCalled();
  });
});

describe("GET /api/pricing-calendar/callback", () => {
  it("stores an encrypted token cookie after a matching state", async () => {
    exchangePricingCalendarCode.mockResolvedValue({
      accessToken: "ya29.token",
      expiresInSeconds: 3599,
    });

    const { GET } = await import("@/app/api/pricing-calendar/callback/route");
    const response = await GET(
      requestWithCookies(
        "https://app.example.com/api/pricing-calendar/callback?code=code_1&state=state_1",
        { "tape-pricing-calendar-state": "state_1" },
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?calendar=connected#pricing",
    );

    const token = response.cookies.get("tape-pricing-calendar-token");
    expect(token?.value).toBe("encrypted:ya29.token");
    expect(token?.httpOnly).toBe(true);
    // Root path so the landing page render can read it.
    expect(token?.path).toBe("/");
    // Capped by the shorter of our window and Google's expiry.
    expect(token?.maxAge).toBe(300);
    // The one-time state cookie is cleared.
    expect(response.cookies.get("tape-pricing-calendar-state")?.maxAge).toBe(0);
  });

  it("rejects a state mismatch without exchanging the code", async () => {
    const { GET } = await import("@/app/api/pricing-calendar/callback/route");
    const response = await GET(
      requestWithCookies(
        "https://app.example.com/api/pricing-calendar/callback?code=code_1&state=attacker",
        { "tape-pricing-calendar-state": "state_1" },
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?calendar=error#pricing",
    );
    expect(exchangePricingCalendarCode).not.toHaveBeenCalled();
    expect(response.cookies.get("tape-pricing-calendar-token")).toBeUndefined();
  });

  it("reports a declined consent screen separately from a failure", async () => {
    const { GET } = await import("@/app/api/pricing-calendar/callback/route");
    const response = await GET(
      requestWithCookies(
        "https://app.example.com/api/pricing-calendar/callback?error=access_denied",
        { "tape-pricing-calendar-state": "state_1" },
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?calendar=denied#pricing",
    );
    expect(exchangePricingCalendarCode).not.toHaveBeenCalled();
  });

  it("falls back to an error redirect when the token exchange fails", async () => {
    exchangePricingCalendarCode.mockRejectedValue(new Error("google is down"));

    const { GET } = await import("@/app/api/pricing-calendar/callback/route");
    const response = await GET(
      requestWithCookies(
        "https://app.example.com/api/pricing-calendar/callback?code=code_1&state=state_1",
        { "tape-pricing-calendar-state": "state_1" },
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/?calendar=error#pricing",
    );
    expect(response.cookies.get("tape-pricing-calendar-token")).toBeUndefined();
  });
});

describe("POST /api/pricing-calendar/forget", () => {
  it("expires the token cookie", async () => {
    const { POST } = await import("@/app/api/pricing-calendar/forget/route");
    const response = await POST();

    expect(response.status).toBe(200);

    const token = response.cookies.get("tape-pricing-calendar-token");
    expect(token?.value).toBe("");
    expect(token?.maxAge).toBe(0);
    expect(token?.path).toBe("/");
  });
});
