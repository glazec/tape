import { afterEach, describe, expect, it, vi } from "vitest";

const {
  autoJoinCalendarEvent,
  insert,
  listRecallCalendarEvents,
  listRecallCalendars,
  retrieveRecallCalendar,
  select,
  update,
  updateRecallCalendar,
} = vi.hoisted(() => ({
    autoJoinCalendarEvent: vi.fn(),
    insert: vi.fn(),
    listRecallCalendarEvents: vi.fn(),
    listRecallCalendars: vi.fn(),
    retrieveRecallCalendar: vi.fn(),
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

vi.mock("@/lib/calendar-auto-join", () => ({
  autoJoinCalendarEvent,
}));

vi.mock("@/lib/vendors/recall", () => ({
  listRecallCalendarEvents,
  listRecallCalendars,
  retrieveRecallCalendar,
  updateRecallCalendar,
}));

describe("processRecallCalendarWebhook", () => {
  afterEach(() => {
    autoJoinCalendarEvent.mockReset();
    insert.mockReset();
    listRecallCalendarEvents.mockReset();
    listRecallCalendars.mockReset();
    retrieveRecallCalendar.mockReset();
    select.mockReset();
    update.mockReset();
    updateRecallCalendar.mockReset();
    vi.resetModules();
  });

  it("syncs changed Recall calendar events into the existing auto join worker", async () => {
    select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "33333333-3333-4333-8333-333333333333",
                teamId: "22222222-2222-4222-8222-222222222222",
                userId: "11111111-1111-4111-8111-111111111111",
                userEmail: "yiping@iosg.vc",
                autoJoinEnabled: true,
              },
            ]),
          }),
        }),
      }),
    });
    update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    listRecallCalendarEvents.mockResolvedValue([
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
          originalStartTime: {
            dateTime: "2026-06-30T12:00:00.000Z",
          },
          attendees: [{ email: "alice@example.com" }],
        },
      },
    ]);
    autoJoinCalendarEvent.mockResolvedValue({
      action: "scheduled",
      recallBotId: "bot_123",
    });

    const { processRecallCalendarWebhook } = await import("@/lib/recall-calendar");

    await expect(
      processRecallCalendarWebhook({
        eventType: "calendar.sync_events",
        calendarId: "44444444-4444-4444-8444-444444444444",
        lastUpdatedTs: "2026-06-30T11:00:00.000Z",
      }),
    ).resolves.toEqual({ action: "synced", count: 1 });

    expect(listRecallCalendarEvents).toHaveBeenCalledWith({
      calendarId: "44444444-4444-4444-8444-444444444444",
      updatedAtGte: "2026-06-30T11:00:00.000Z",
    });
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith({
      connection: {
        id: "33333333-3333-4333-8333-333333333333",
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        autoJoinEnabled: true,
        workspaceDomain: "iosg.vc",
      },
      event: expect.objectContaining({
        externalEventId: "google_event_123",
        recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
        recallCalendarEventDeduplicationKey:
          "shared_event_123@example.com:2026-06-30T12:00:00.000Z",
        title: "Partner sync",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        attendeeEmails: ["alice@example.com"],
      }),
    });
  });

  it("pulls upcoming Recall calendar events for a connected workspace", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "33333333-3333-4333-8333-333333333333",
              teamId: "22222222-2222-4222-8222-222222222222",
              userId: "11111111-1111-4111-8111-111111111111",
              autoJoinEnabled: true,
              recallCalendarId: "44444444-4444-4444-8444-444444444444",
            },
          ]),
        }),
      }),
    });
    update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    listRecallCalendarEvents.mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        platform_id: "google_event_123",
        ical_uid: "shared_event_123@example.com",
        start_time: "2026-06-30T12:00:00.000Z",
        end_time: "2026-06-30T12:30:00.000Z",
        meeting_url: "https://meet.google.com/abc-defg-hij",
        is_deleted: false,
        raw: {
          summary: "Partner sync",
          originalStartTime: {
            dateTime: "2026-06-30T12:00:00.000Z",
          },
        },
      },
    ]);
    autoJoinCalendarEvent.mockResolvedValue({
      action: "scheduled",
      recallBotId: "bot_123",
    });

    const { syncRecallCalendarEventsForWorkspace } = await import(
      "@/lib/recall-calendar"
    );

    await expect(
      syncRecallCalendarEventsForWorkspace({
        workspace: {
          userId: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "example.com",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-27T04:00:00.000Z"),
      }),
    ).resolves.toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 1,
    });

    expect(listRecallCalendarEvents).toHaveBeenCalledWith({
      calendarId: "44444444-4444-4444-8444-444444444444",
      startTimeGte: "2026-06-26T04:00:00.000Z",
    });
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith({
      connection: {
        id: "33333333-3333-4333-8333-333333333333",
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        autoJoinEnabled: true,
        workspaceDomain: "example.com",
      },
      event: expect.objectContaining({
        externalEventId: "google_event_123",
        recallCalendarEventId: "55555555-5555-4555-8555-555555555555",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
      }),
    });
  });

  it("reconciles recently started Recall calendar events that have not ended", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "33333333-3333-4333-8333-333333333333",
              teamId: "22222222-2222-4222-8222-222222222222",
              userId: "11111111-1111-4111-8111-111111111111",
              autoJoinEnabled: true,
              recallCalendarId: "44444444-4444-4444-8444-444444444444",
            },
          ]),
        }),
      }),
    });
    update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    listRecallCalendarEvents.mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        platform_id: "google_event_123",
        start_time: "2026-06-27T03:30:00.000Z",
        end_time: "2026-06-27T04:15:00.000Z",
        meeting_url: "https://zoom.us/j/8166024230",
        is_deleted: false,
        raw: {
          summary: "Investment strategy moved",
        },
      },
    ]);
    autoJoinCalendarEvent.mockResolvedValue({
      action: "updated",
      recallBotId: "bot_123",
    });

    const { syncRecallCalendarEventsForWorkspace } = await import(
      "@/lib/recall-calendar"
    );

    await expect(
      syncRecallCalendarEventsForWorkspace({
        workspace: {
          userId: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "example.com",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-27T04:00:00.000Z"),
      }),
    ).resolves.toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 1,
    });

    expect(listRecallCalendarEvents).toHaveBeenCalledWith({
      calendarId: "44444444-4444-4444-8444-444444444444",
      startTimeGte: "2026-06-26T04:00:00.000Z",
    });
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          externalEventId: "google_event_123",
          startsAt: "2026-06-27T03:30:00.000Z",
          endsAt: "2026-06-27T04:15:00.000Z",
        }),
      }),
    );
  });

  it("passes deleted future Recall calendar events through repair sync", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "33333333-3333-4333-8333-333333333333",
              teamId: "22222222-2222-4222-8222-222222222222",
              userId: "11111111-1111-4111-8111-111111111111",
              autoJoinEnabled: true,
              recallCalendarId: "44444444-4444-4444-8444-444444444444",
            },
          ]),
        }),
      }),
    });
    update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    listRecallCalendarEvents.mockResolvedValue([
      {
        id: "55555555-5555-4555-8555-555555555555",
        platform_id: "google_event_123",
        start_time: "2026-06-30T12:00:00.000Z",
        end_time: "2026-06-30T12:30:00.000Z",
        meeting_url: "https://zoom.us/j/8166024230",
        is_deleted: true,
        raw: {
          summary: "Cancelled partner sync",
        },
      },
    ]);
    autoJoinCalendarEvent.mockResolvedValue({
      action: "skipped",
      reason: "missing_meeting_link",
    });

    const { syncRecallCalendarEventsForWorkspace } = await import(
      "@/lib/recall-calendar"
    );

    await expect(
      syncRecallCalendarEventsForWorkspace({
        workspace: {
          userId: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "example.com",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-29T04:00:00.000Z"),
      }),
    ).resolves.toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 1,
    });

    expect(listRecallCalendarEvents).toHaveBeenCalledWith({
      calendarId: "44444444-4444-4444-8444-444444444444",
      startTimeGte: "2026-06-28T04:00:00.000Z",
    });
    expect(autoJoinCalendarEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          externalEventId: "google_event_123",
          isDeleted: true,
          meetingUrl: null,
        }),
      }),
    );
  });

  it("upgrades an existing local calendar row to a Recall managed calendar", async () => {
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const workspaceLimit = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "33333333-3333-4333-8333-333333333333",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
          autoJoinEnabled: false,
          recallCalendarId: null,
          recallCalendarStatus: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "33333333-3333-4333-8333-333333333333",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
          autoJoinEnabled: false,
          recallCalendarId: null,
          recallCalendarStatus: null,
        },
      ]);

    select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
        where: () => ({
          limit: workspaceLimit,
        }),
      }),
    });
    update.mockReturnValue({
      set: updateSet,
    });
    listRecallCalendars.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        platform: "google_calendar",
        platform_email: "yiping@iosg.vc",
        status: "connected",
        metadata: {
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
        },
      },
    ]);
    listRecallCalendarEvents.mockResolvedValue([]);

    const { syncRecallCalendarEventsForWorkspace } = await import(
      "@/lib/recall-calendar"
    );

    await expect(
      syncRecallCalendarEventsForWorkspace({
        workspace: {
          userId: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "iosg.vc",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-27T04:00:00.000Z"),
      }),
    ).resolves.toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 0,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        externalCalendarId: "primary",
        recallCalendarId: "44444444-4444-4444-8444-444444444444",
        recallCalendarStatus: "connected",
      }),
    );
  });

  it("adopts a Recall managed calendar when the workspace has no local connection", async () => {
    const values = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([
        {
          id: "33333333-3333-4333-8333-333333333333",
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
          autoJoinEnabled: true,
          recallCalendarId: "44444444-4444-4444-8444-444444444444",
          recallCalendarStatus: "connected",
        },
      ]),
    });

    select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    insert.mockReturnValue({
      values,
    });
    update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    listRecallCalendars.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        platform: "google_calendar",
        platform_email: "yiping@iosg.vc",
        status: "connected",
        metadata: {
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
        },
      },
    ]);
    listRecallCalendarEvents.mockResolvedValue([]);

    const { syncRecallCalendarEventsForWorkspace } = await import(
      "@/lib/recall-calendar"
    );

    await expect(
      syncRecallCalendarEventsForWorkspace({
        workspace: {
          userId: "11111111-1111-4111-8111-111111111111",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "iosg.vc",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-27T04:00:00.000Z"),
      }),
    ).resolves.toEqual({
      connectionId: "33333333-3333-4333-8333-333333333333",
      syncedEventCount: 0,
    });

    expect(listRecallCalendars).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        externalCalendarId: "primary",
        recallCalendarId: "44444444-4444-4444-8444-444444444444",
        recallCalendarStatus: "connected",
      }),
    );
    expect(listRecallCalendarEvents).toHaveBeenCalledWith({
      calendarId: "44444444-4444-4444-8444-444444444444",
      startTimeGte: "2026-06-26T04:00:00.000Z",
    });
    expect(updateRecallCalendar).not.toHaveBeenCalled();
  });

  it("does not adopt a Recall managed calendar tagged to another workspace", async () => {
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "33333333-3333-4333-8333-333333333333",
                teamId: "22222222-2222-4222-8222-222222222222",
                userId: "11111111-1111-4111-8111-111111111111",
                userEmail: "yiping@iosg.vc",
                autoJoinEnabled: true,
                recallCalendarId: "44444444-4444-4444-8444-444444444444",
                recallCalendarStatus: "connected",
              },
            ]),
          }),
        }),
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    update.mockReturnValue({
      set: updateSet,
    });
    listRecallCalendars.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        platform: "google_calendar",
        platform_email: "yiping@iosg.vc",
        status: "connected",
        metadata: {
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
        },
      },
    ]);
    listRecallCalendarEvents.mockResolvedValue([]);
    updateRecallCalendar.mockResolvedValue({});

    const {
      RecallCalendarConnectionError,
      syncRecallCalendarEventsForWorkspace,
    } = await import("@/lib/recall-calendar");

    await expect(
      syncRecallCalendarEventsForWorkspace({
        workspace: {
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          teamId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          domain: "cybertinolab.com",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-27T04:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(RecallCalendarConnectionError);

    expect(updateSet).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(updateRecallCalendar).not.toHaveBeenCalled();
    expect(listRecallCalendarEvents).not.toHaveBeenCalled();
    expect(autoJoinCalendarEvent).not.toHaveBeenCalled();
  });

  it("does not adopt a Recall managed calendar tagged to another user on the same team", async () => {
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "33333333-3333-4333-8333-333333333333",
                teamId: "22222222-2222-4222-8222-222222222222",
                userId: "11111111-1111-4111-8111-111111111111",
                userEmail: "yiping@iosg.vc",
                autoJoinEnabled: true,
                recallCalendarId: "44444444-4444-4444-8444-444444444444",
                recallCalendarStatus: "connected",
              },
            ]),
          }),
        }),
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    update.mockReturnValue({
      set: updateSet,
    });
    listRecallCalendars.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        platform: "google_calendar",
        platform_email: "yiping@iosg.vc",
        status: "connected",
        metadata: {
          teamId: "22222222-2222-4222-8222-222222222222",
          userId: "11111111-1111-4111-8111-111111111111",
        },
      },
    ]);
    listRecallCalendarEvents.mockResolvedValue([]);
    updateRecallCalendar.mockResolvedValue({});

    const {
      RecallCalendarConnectionError,
      syncRecallCalendarEventsForWorkspace,
    } = await import("@/lib/recall-calendar");

    await expect(
      syncRecallCalendarEventsForWorkspace({
        workspace: {
          userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          teamId: "22222222-2222-4222-8222-222222222222",
          domain: "iosg.vc",
        },
        autoJoinEnabled: true,
        now: new Date("2026-06-27T04:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(RecallCalendarConnectionError);

    expect(updateSet).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(updateRecallCalendar).not.toHaveBeenCalled();
    expect(listRecallCalendarEvents).not.toHaveBeenCalled();
    expect(autoJoinCalendarEvent).not.toHaveBeenCalled();
  });
});
