import { afterEach, describe, expect, it, vi } from "vitest";

describe("Recall Calendar V2 adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("creates a Calendar V2 connection from Google OAuth credentials", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "44444444-4444-4444-8444-444444444444",
          platform: "google_calendar",
          platform_email: "test@iosg.vc",
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
    ).resolves.toEqual(
      expect.objectContaining({
        id: "44444444-4444-4444-8444-444444444444",
        status: "connecting",
      }),
    );

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

  it("lists Recall managed calendars", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          next: null,
          results: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              platform: "google_calendar",
              platform_email: "test@iosg.vc",
              status: "connected",
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

    const { listRecallCalendars } = await import("@/lib/vendors/recall");

    await expect(listRecallCalendars()).resolves.toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        platform: "google_calendar",
        platform_email: "test@iosg.vc",
        status: "connected",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v2/calendars/",
      {
        method: "GET",
        headers: {
          Authorization: "Token recall-key",
          Accept: "application/json",
        },
      },
    );
  });

  it("deletes a Recall managed calendar", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { deleteRecallCalendar } = await import("@/lib/vendors/recall");

    await expect(
      deleteRecallCalendar({
        calendarId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({});

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v2/calendars/44444444-4444-4444-8444-444444444444/",
      {
        method: "DELETE",
        headers: {
          Authorization: "Token recall-key",
          Accept: "application/json",
        },
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
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
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

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://us-east-1.recall.ai/api/v2/calendar-events/55555555-5555-4555-8555-555555555555/bot/",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Token recall-key",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      deduplication_key: "shared_event_123@example.com",
      bot_config: {
        bot_name: "IOSG Old Friend",
        automatic_leave: {
          waiting_room_timeout: 3600,
        },
        automatic_video_output: {
          in_call_not_recording: {
            kind: "jpeg",
            b64_data: expect.any(String),
          },
          in_call_recording: {
            kind: "jpeg",
            b64_data: expect.any(String),
          },
        },
        recording_config: {
          video_mixed_participant_video_when_screenshare: "hide",
          realtime_endpoints: [
            {
              type: "webhook",
              url: "https://app.example.com/api/recall/realtime/webhook",
              events: [
                "participant_events.chat_message",
                "participant_events.speech_on",
                "participant_events.speech_off",
              ],
            },
          ],
        },
        metadata: {
          calendarEventId: "33333333-3333-4333-8333-333333333333",
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      },
    });
  });

  it("treats a missing Calendar V2 event bot as already deleted", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("", {
        status: 404,
        statusText: "Not Found",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { deleteRecallCalendarEventBot } = await import(
      "@/lib/vendors/recall"
    );

    await expect(
      deleteRecallCalendarEventBot({
        calendarEventId: "55555555-5555-4555-8555-555555555555",
      }),
    ).resolves.toEqual({});
  });
});
