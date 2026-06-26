import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getAccessToken,
  getStoredGoogleCalendarAccessToken,
  insert,
  select,
  send,
  update,
} = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getStoredGoogleCalendarAccessToken: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  send: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: {
    getAccessToken,
  },
}));

vi.mock("@/lib/google-calendar-oauth", () => ({
  getStoredGoogleCalendarAccessToken,
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
    update,
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send,
  },
}));

describe("Google Calendar capture", () => {
  afterEach(() => {
    getAccessToken.mockReset();
    getStoredGoogleCalendarAccessToken.mockReset();
    insert.mockReset();
    select.mockReset();
    send.mockReset();
    update.mockReset();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("requests a Google access token for Calendar event reads", async () => {
    getAccessToken.mockResolvedValue({
      data: { accessToken: "google-access-token" },
      error: null,
    });
    const { getGoogleCalendarAccessToken } = await import(
      "@/lib/google-calendar"
    );

    await expect(getGoogleCalendarAccessToken()).resolves.toBe(
      "google-access-token",
    );
    expect(getAccessToken).toHaveBeenCalledWith({
      providerId: "google",
    });
  });

  it("uses a stored Google Calendar token when one is connected", async () => {
    getStoredGoogleCalendarAccessToken.mockResolvedValue("stored-access-token");
    const { getGoogleCalendarAccessToken } = await import(
      "@/lib/google-calendar"
    );

    await expect(
      getGoogleCalendarAccessToken({
        userId: "11111111-1111-4111-8111-111111111111",
        teamId: "22222222-2222-4222-8222-222222222222",
        domain: "example.com",
      }),
    ).resolves.toBe("stored-access-token");
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("fetches upcoming primary calendar events with conference metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        items: [
          {
            id: "google_event_123",
            summary: "Partner sync",
            description: "Agenda",
            location: null,
            hangoutLink: "https://meet.google.com/abc-defg-hij",
            start: { dateTime: "2026-06-30T12:00:00Z" },
            end: { dateTime: "2026-06-30T12:30:00Z" },
            attendees: [
              { email: "alice@example.com" },
              { email: "guest@vendor.com" },
            ],
            conferenceData: {
              entryPoints: [
                {
                  entryPointType: "video",
                  uri: "https://meet.google.com/abc-defg-hij",
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGoogleCalendarEvents } = await import("@/lib/google-calendar");

    await expect(
      fetchGoogleCalendarEvents({
        accessToken: "google-access-token",
        now: new Date("2026-06-26T12:00:00Z"),
      }),
    ).resolves.toEqual([
      {
        externalEventId: "google_event_123",
        title: "Partner sync",
        startsAt: "2026-06-30T12:00:00Z",
        endsAt: "2026-06-30T12:30:00Z",
        attendeeEmails: ["alice@example.com", "guest@vendor.com"],
        meetingUrl: null,
        location: null,
        description: "Agenda",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        conferenceData: {
          entryPoints: [
            {
              entryPointType: "video",
              uri: "https://meet.google.com/abc-defg-hij",
            },
          ],
        },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      ),
      expect.objectContaining({
        headers: {
          Authorization: "Bearer google-access-token",
          Accept: "application/json",
        },
      }),
    );
    expect(fetchMock.mock.calls[0][0]).toContain("singleEvents=true");
    expect(fetchMock.mock.calls[0][0]).toContain("orderBy=startTime");
  });

  it("stores a calendar connection and emits synced events", async () => {
    getAccessToken.mockResolvedValue({
      data: { accessToken: "google-access-token" },
      error: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          items: [
            {
              id: "google_event_123",
              summary: "Partner sync",
              start: { dateTime: "2026-06-30T12:00:00Z" },
            },
          ],
        }),
      }),
    );
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
    send.mockResolvedValue({ ids: ["evt_123"] });

    const { syncGooglePrimaryCalendarEvents } = await import(
      "@/lib/google-calendar"
    );

    await expect(
      syncGooglePrimaryCalendarEvents({
        sessionUser: {
          id: "auth_user_123",
          email: "alice@example.com",
          name: null,
        },
        workspace: {
          userId: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "example.com",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-26T12:00:00Z"),
      }),
    ).resolves.toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 1,
    });

    expect(insertValues).toHaveBeenCalledWith({
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "11111111-1111-4111-8111-111111111111",
      provider: "google",
      externalCalendarId: "primary",
      autoJoinEnabled: true,
    });
    expect(send).toHaveBeenCalledWith([
      {
        name: "calendar/event.synced",
        data: {
          connection: {
            id: "33333333-3333-4333-8333-333333333333",
            teamId: "22222222-2222-4222-8222-222222222222",
            userId: "11111111-1111-4111-8111-111111111111",
            autoJoinEnabled: true,
          },
          event: expect.objectContaining({
            externalEventId: "google_event_123",
            title: "Partner sync",
          }),
        },
      },
    ]);
  });
});
