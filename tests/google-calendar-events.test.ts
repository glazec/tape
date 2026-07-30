import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchGoogleCalendarEvents } from "@/lib/google-calendar-events";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGoogleCalendarEvents", () => {
  it("requests participation fields without reading meeting content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGoogleCalendarEvents({
      accessToken: "token",
      timeMin: new Date("2026-04-01T00:00:00Z"),
      timeMax: new Date("2026-07-01T00:00:00Z"),
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    const fields = requestUrl.searchParams.get("fields") ?? "";

    expect(fields).toContain("eventType");
    expect(fields).toContain("organizer(email,self)");
    expect(fields).toContain("responseStatus");
    expect(fields).toContain("attendees(");
    expect(fields).not.toContain("summary");
    expect(fields).not.toContain("description");
    expect(result).toEqual({
      events: [],
      eventDateSpanDays: null,
      truncated: false,
    });
  });

  it("reports the retained event date span when more than 2,000 events exist", async () => {
    let page = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      const pageIndex = page;
      page += 1;

      return {
        ok: true,
        json: async () => ({
          items: Array.from({ length: 250 }, (_, itemIndex) => ({
            start: {
              dateTime: new Date(
                Date.parse("2026-04-01T00:00:00Z") +
                  (pageIndex * 250 + itemIndex) * 30 * 60 * 1000,
              ).toISOString(),
            },
          })),
          nextPageToken: "more",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchGoogleCalendarEvents({
      accessToken: "token",
      timeMin: new Date("2026-04-01T00:00:00Z"),
      timeMax: new Date("2026-07-01T00:00:00Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(result.events).toHaveLength(2_000);
    expect(result.truncated).toBe(true);
    expect(result.eventDateSpanDays).toBeCloseTo(
      (1_999 * 30 * 60 * 1000) / (24 * 60 * 60 * 1000),
    );
  });
});
