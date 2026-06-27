import { afterEach, describe, expect, it, vi } from "vitest";

describe("Recall Calendar V2 adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("creates a Recall calendar from Google OAuth credentials", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "44444444-4444-4444-8444-444444444444",
          status: "connecting",
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { createRecallCalendar } = await import("@/lib/vendors/recall");

    await expect(
      createRecallCalendar({
        oauthClientId: "google-client-id",
        oauthClientSecret: "google-client-secret",
        oauthRefreshToken: "google-refresh-token",
        platform: "google_calendar",
        metadata: {
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).resolves.toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      status: "connecting",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v2/calendars/",
      {
        method: "POST",
        headers: {
          Authorization: "Token recall-key",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          oauth_client_id: "google-client-id",
          oauth_client_secret: "google-client-secret",
          oauth_refresh_token: "google-refresh-token",
          platform: "google_calendar",
          metadata: {
            teamId: "22222222-2222-4222-8222-222222222222",
            userId: "11111111-1111-4111-8111-111111111111",
          },
        }),
      },
    );
  });

  it("lists changed Recall calendar events for a calendar sync webhook", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          next: null,
          results: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              calendar_id: "44444444-4444-4444-8444-444444444444",
              platform_id: "google_event_123",
              ical_uid: "shared_event_123@example.com",
              start_time: "2026-06-30T12:00:00.000Z",
              end_time: "2026-06-30T12:30:00.000Z",
              meeting_url: "https://meet.google.com/abc-defg-hij",
              is_deleted: false,
              raw: {
                summary: "Partner sync",
                attendees: [{ email: "alice@example.com" }],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { listRecallCalendarEvents } = await import("@/lib/vendors/recall");

    await expect(
      listRecallCalendarEvents({
        calendarId: "44444444-4444-4444-8444-444444444444",
        updatedAtGte: "2026-06-30T11:00:00.000Z",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "55555555-5555-4555-8555-555555555555",
        meeting_url: "https://meet.google.com/abc-defg-hij",
      }),
    ]);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://us-east-1.recall.ai/api/v2/calendar-events/?calendar_id=44444444-4444-4444-8444-444444444444&updated_at__gte=2026-06-30T11%3A00%3A00.000Z",
    );
  });

  it("schedules a Recall bot for a Calendar V2 event", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "55555555-5555-4555-8555-555555555555",
          bots: [
            {
              bot_id: "bot_123",
              deduplication_key: "shared_event_123@example.com",
              meeting_url: "https://meet.google.com/abc-defg-hij",
              start_time: "2026-06-30T12:00:00.000Z",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { scheduleRecallCalendarEventBot } = await import(
      "@/lib/vendors/recall"
    );

    await expect(
      scheduleRecallCalendarEventBot({
        calendarEventId: "55555555-5555-4555-8555-555555555555",
        deduplicationKey: "shared_event_123@example.com",
        botName: "IOSG Old Friend",
        metadata: {
          calendarEventId: "33333333-3333-4333-8333-333333333333",
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).resolves.toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      bots: [
        {
          bot_id: "bot_123",
          deduplication_key: "shared_event_123@example.com",
          meeting_url: "https://meet.google.com/abc-defg-hij",
          start_time: "2026-06-30T12:00:00.000Z",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v2/calendar-events/55555555-5555-4555-8555-555555555555/bot/",
      {
        method: "POST",
        headers: {
          Authorization: "Token recall-key",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          deduplication_key: "shared_event_123@example.com",
          bot_config: {
            bot_name: "IOSG Old Friend",
            metadata: {
              calendarEventId: "33333333-3333-4333-8333-333333333333",
              meetingId: "11111111-1111-4111-8111-111111111111",
            },
          },
        }),
      },
    );
  });
});
