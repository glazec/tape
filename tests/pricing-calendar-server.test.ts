import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  decryptPricingCalendarToken,
  fetchGoogleAccountEmail,
  fetchGoogleCalendarEvents,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  decryptPricingCalendarToken: vi.fn(),
  fetchGoogleAccountEmail: vi.fn(),
  fetchGoogleCalendarEvents: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("@/lib/pricing-calendar-oauth", () => ({
  decryptPricingCalendarToken,
  PRICING_CALENDAR_TOKEN_COOKIE: "tape-pricing-calendar-token",
}));
vi.mock("@/lib/google-calendar-events", () => ({
  fetchGoogleAccountEmail,
  fetchGoogleCalendarEvents,
  GoogleCalendarReadError: class GoogleCalendarReadError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { readPricingCalendarEstimate } from "@/lib/pricing-calendar-server";

describe("readPricingCalendarEstimate", () => {
  beforeEach(() => {
    cookies.mockResolvedValue({
      get: () => ({ value: "encrypted-token" }),
    });
    decryptPricingCalendarToken.mockReturnValue("access-token");
    fetchGoogleAccountEmail.mockResolvedValue("me@acme.com");
  });

  it("normalizes a capped sample using its retained event date span", async () => {
    fetchGoogleCalendarEvents.mockResolvedValue({
      events: Array.from({ length: 2_000 }, (_, index) => ({
        status: "confirmed",
        eventType: "default",
        start: {
          dateTime: new Date(
            Date.parse("2026-04-01T00:00:00Z") +
              index * 30 * 60 * 1000,
          ).toISOString(),
        },
        end: {
          dateTime: new Date(
            Date.parse("2026-04-01T00:30:00Z") +
              index * 30 * 60 * 1000,
          ).toISOString(),
        },
        organizer: { email: "me@acme.com", self: true },
        attendees: [
          { email: "me@acme.com", self: true },
          { email: "guest@example.com" },
        ],
      })),
      eventDateSpanDays: 41.65,
      truncated: true,
    });

    const result = await readPricingCalendarEstimate();

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("Expected a calendar estimate");
    }

    expect(result.payload.lookbackDays).toBe(41.65);
    expect(result.payload.eventLimitReached).toBe(true);
    expect(result.payload.scannedEventCount).toBe(2_000);
  });
});
