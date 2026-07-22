import { afterEach, describe, expect, it, vi } from "vitest";

const { assertCanCreateMeetings, getOrCreateWorkspaceForSessionUser, insert, reconcileMeetingSharingForMeeting, select, update } =
  vi.hoisted(() => ({
    assertCanCreateMeetings: vi.fn(),
    getOrCreateWorkspaceForSessionUser: vi.fn(),
    insert: vi.fn(),
    reconcileMeetingSharingForMeeting: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
    update,
  },
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
}));

vi.mock("@/lib/meeting-share-rules", () => ({
  reconcileMeetingSharingForMeeting,
}));

function collectStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item, seen));
  }

  return Object.values(value).flatMap((item) => collectStrings(item, seen));
}

describe("meeting bot records", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    getOrCreateWorkspaceForSessionUser.mockReset();
    insert.mockReset();
    reconcileMeetingSharingForMeeting.mockReset();
    select.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("previews a calendar match without changing meeting records", async () => {
    getOrCreateWorkspaceForSessionUser.mockResolvedValue({
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    const limit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "IOSG <> Faves",
        meetingUrl: "https://zoom.us/j/8436420171",
        startsAt: new Date("2026-07-22T15:30:00.000Z"),
        endsAt: new Date("2026-07-22T16:15:00.000Z"),
      },
    ]);
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit }) }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "44444444-4444-4444-8444-444444444444",
                recallBotId: "existing_bot",
                status: "scheduled",
              },
            ]),
          }),
        }),
      });
    const { findScheduledMeetingBotCalendarCandidates } = await import(
      "@/lib/meeting-bot-records"
    );

    await expect(
      findScheduledMeetingBotCalendarCandidates({
        now: new Date("2026-07-22T15:04:00.000Z"),
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
      }),
    ).resolves.toEqual([
      {
        action: "join",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        endedAt: "2026-07-22T16:15:00.000Z",
        startedAt: "2026-07-22T15:30:00.000Z",
        title: "IOSG <> Faves",
      },
    ]);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("includes a meeting running late but excludes a distant meeting", async () => {
    getOrCreateWorkspaceForSessionUser.mockResolvedValue({
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    const limit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Meeting running late",
        teamMeetingKey: "late-meeting",
        meetingUrl: "https://zoom.us/j/8436420171",
        startsAt: new Date("2026-07-22T14:00:00.000Z"),
        endsAt: new Date("2026-07-22T15:00:00.000Z"),
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        title: "Later meeting",
        teamMeetingKey: "later-meeting",
        meetingUrl: "https://zoom.us/j/8436420172",
        startsAt: new Date("2026-07-22T16:00:00.000Z"),
        endsAt: new Date("2026-07-22T16:30:00.000Z"),
      },
    ]);
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit }) }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "44444444-4444-4444-8444-444444444444",
                recallBotId: "existing_bot",
                status: "scheduled",
              },
            ]),
          }),
        }),
      });
    const { findScheduledMeetingBotCalendarCandidates } = await import(
      "@/lib/meeting-bot-records"
    );

    await expect(
      findScheduledMeetingBotCalendarCandidates({
        now: new Date("2026-07-22T15:10:00.000Z"),
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
      }),
    ).resolves.toEqual([
      {
        action: "join",
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        endedAt: "2026-07-22T15:00:00.000Z",
        startedAt: "2026-07-22T14:00:00.000Z",
        title: "Meeting running late",
      },
    ]);
  });

  it("creates a separate meeting without applying a calendar match", async () => {
    getOrCreateWorkspaceForSessionUser.mockResolvedValue({
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    const returning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const values = vi.fn().mockReturnValue({ returning });
    insert.mockReturnValue({ values });
    const { createScheduledMeetingBot } = await import(
      "@/lib/meeting-bot-records"
    );

    await createScheduledMeetingBot({
      meetingUrl: "https://zoom.us/j/8436420171",
      platform: "zoom",
      sessionUser: {
        id: "user_123",
        email: "test@iosg.vc",
        name: null,
      },
      skipCalendarMatch: true,
    });

    expect(select).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith({
      meetingUrl: "https://zoom.us/j/8436420171",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      platform: "zoom",
      status: "scheduled",
      teamId: "22222222-2222-4222-8222-222222222222",
      title: "Zoom recording",
    });
  });

  it("links a replacement URL to a confirmed nearby calendar event", async () => {
    const workspace = {
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    };
    getOrCreateWorkspaceForSessionUser.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);

    const calendarLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "AI Training",
        meetingUrl: "https://zoom.us/j/8851797582",
        startsAt: new Date("2026-07-02T02:00:00.000Z"),
        endsAt: new Date("2026-07-02T03:00:00.000Z"),
      },
    ]);
    const meetingLimit = vi.fn().mockResolvedValue([]);
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: calendarLimit,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: meetingLimit,
          }),
        }),
      });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    insert.mockReturnValue({ values: meetingValues });

    const { createScheduledMeetingBot } = await import("@/lib/meeting-bot-records");

    await expect(
      createScheduledMeetingBot({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
        meetingUrl: "https://zoom.us/j/9999999999",
        now: new Date("2026-07-02T01:45:00.000Z"),
        platform: "zoom",
      }),
    ).resolves.toEqual({
      meetingId: "44444444-4444-4444-8444-444444444444",
      teamId: "22222222-2222-4222-8222-222222222222",
      startAt: "2026-07-02T02:00:00.000Z",
    });
    expect(reconcileMeetingSharingForMeeting).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
    );

    expect(meetingValues).toHaveBeenCalledWith({
      teamId: "22222222-2222-4222-8222-222222222222",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      title: "AI Training",
      platform: "zoom",
      status: "scheduled",
      meetingUrl: "https://zoom.us/j/9999999999",
      startedAt: new Date("2026-07-02T02:00:00.000Z"),
      endedAt: new Date("2026-07-02T03:00:00.000Z"),
    });
  });

  it("reuses an existing scheduled meeting for a matching calendar event", async () => {
    const workspace = {
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    };
    getOrCreateWorkspaceForSessionUser.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);

    const calendarLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "AI Training",
        meetingUrl: "https://zoom.us/j/8851797582",
        startsAt: new Date("2026-07-02T02:00:00.000Z"),
        endsAt: new Date("2026-07-02T03:00:00.000Z"),
      },
    ]);
    const meetingLimit = vi.fn().mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        recallBotId: "existing_bot",
        status: "scheduled",
      },
    ]);
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: calendarLimit,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: meetingLimit,
          }),
        }),
      });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    update.mockReturnValue({ set: updateSet });

    const { createScheduledMeetingBot } = await import("@/lib/meeting-bot-records");

    await expect(
      createScheduledMeetingBot({
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
        meetingUrl: "https://zoom.us/j/8851797582",
        platform: "zoom",
      }),
    ).resolves.toEqual({
      meetingId: "44444444-4444-4444-8444-444444444444",
      teamId: "22222222-2222-4222-8222-222222222222",
      startAt: "2026-07-02T02:00:00.000Z",
      recallBotId: "existing_bot",
    });

    expect(insert).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingUrl: "https://zoom.us/j/8851797582",
        status: "scheduled",
      }),
    );
  });

  it("matches a calendar event when only the Zoom host differs", async () => {
    const workspace = {
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    };
    getOrCreateWorkspaceForSessionUser.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);

    const calendarLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Partner sync",
        meetingUrl: null,
        startsAt: new Date("2026-07-02T02:00:00.000Z"),
        endsAt: new Date("2026-07-02T03:00:00.000Z"),
      },
    ]);
    const meetingLimit = vi.fn().mockResolvedValue([]);
    const calendarWhere = vi.fn().mockReturnValue({
      orderBy: () => ({
        limit: calendarLimit,
      }),
    });

    select
      .mockReturnValueOnce({
        from: () => ({
          where: calendarWhere,
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: meetingLimit,
          }),
        }),
      });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    insert.mockReturnValue({ values: meetingValues });

    const { createScheduledMeetingBot } = await import("@/lib/meeting-bot-records");

    await expect(
      createScheduledMeetingBot({
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
        meetingUrl: "https://zoom.us/j/1234567890",
        platform: "zoom",
      }),
    ).resolves.toEqual({
      meetingId: "44444444-4444-4444-8444-444444444444",
      teamId: "22222222-2222-4222-8222-222222222222",
      startAt: "2026-07-02T02:00:00.000Z",
    });

    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        meetingUrl: "https://zoom.us/j/1234567890",
      }),
    );
    expect(collectStrings(calendarWhere.mock.calls[0][0])).toContain(
      "%/j/1234567890%",
    );
  });

  it("pre-schedules a bot when a unique link matches one far-future event", async () => {
    const workspace = {
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    };
    getOrCreateWorkspaceForSessionUser.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);

    // A one-off link that matches exactly one event, 11 days out.
    const calendarLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "IOSG <> Dinari",
        meetingUrl: "https://zoom.us/j/1112223334",
        startsAt: new Date("2026-07-22T01:00:00.000Z"),
        endsAt: new Date("2026-07-22T01:30:00.000Z"),
      },
    ]);
    const meetingLimit = vi.fn().mockResolvedValue([]);
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: calendarLimit,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: meetingLimit,
          }),
        }),
      });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    insert.mockReturnValue({ values: meetingValues });

    const { createScheduledMeetingBot } = await import("@/lib/meeting-bot-records");

    await expect(
      createScheduledMeetingBot({
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
        meetingUrl: "https://zoom.us/j/1112223334",
        platform: "zoom",
        now: new Date("2026-07-11T02:00:00.000Z"),
      }),
    ).resolves.toEqual({
      meetingId: "44444444-4444-4444-8444-444444444444",
      teamId: "22222222-2222-4222-8222-222222222222",
      startAt: "2026-07-22T01:00:00.000Z",
    });

    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        title: "IOSG <> Dinari",
      }),
    );
  });

  it("joins immediately when an ambiguous link matches several far-future events", async () => {
    const workspace = {
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    };
    getOrCreateWorkspaceForSessionUser.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);

    // A reused personal meeting room that matches many future events.
    const calendarLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "ray <> YP",
        meetingUrl: "https://zoom.us/j/8436420171",
        startsAt: new Date("2026-07-22T01:00:00.000Z"),
        endsAt: new Date("2026-07-22T01:30:00.000Z"),
      },
      {
        id: "33333333-3333-4333-8333-333333333334",
        title: "David <> YP",
        meetingUrl: "https://zoom.us/j/8436420171",
        startsAt: new Date("2026-07-23T15:00:00.000Z"),
        endsAt: new Date("2026-07-23T15:30:00.000Z"),
      },
    ]);
    select.mockReturnValueOnce({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: calendarLimit,
          }),
        }),
      }),
    });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    insert.mockReturnValue({ values: meetingValues });

    const { createScheduledMeetingBot } = await import("@/lib/meeting-bot-records");

    await expect(
      createScheduledMeetingBot({
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
        meetingUrl: "https://zoom.us/j/8436420171",
        platform: "zoom",
        now: new Date("2026-07-11T02:00:00.000Z"),
      }),
    ).resolves.toEqual({
      meetingId: "44444444-4444-4444-8444-444444444444",
      teamId: "22222222-2222-4222-8222-222222222222",
    });

    expect(meetingValues).toHaveBeenCalledWith({
      teamId: "22222222-2222-4222-8222-222222222222",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      title: "Zoom recording",
      platform: "zoom",
      status: "scheduled",
      meetingUrl: "https://zoom.us/j/8436420171",
    });
  });

  it("keeps the calendar match when the event starts within thirty minutes", async () => {
    const workspace = {
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "55555555-5555-4555-8555-555555555555",
      domain: "iosg.vc",
      canCreateMeetings: true,
    };
    getOrCreateWorkspaceForSessionUser.mockResolvedValue(workspace);
    assertCanCreateMeetings.mockResolvedValue(undefined);

    const calendarLimit = vi.fn().mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Kimpton <> IOSG",
        meetingUrl: "https://zoom.us/j/8436420171",
        startsAt: new Date("2026-07-11T02:20:00.000Z"),
        endsAt: new Date("2026-07-11T03:00:00.000Z"),
      },
    ]);
    const meetingLimit = vi.fn().mockResolvedValue([]);
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: calendarLimit,
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: meetingLimit,
          }),
        }),
      });

    const meetingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "44444444-4444-4444-8444-444444444444" }]);
    const meetingValues = vi.fn().mockReturnValue({ returning: meetingReturning });
    insert.mockReturnValue({ values: meetingValues });

    const { createScheduledMeetingBot } = await import("@/lib/meeting-bot-records");

    await expect(
      createScheduledMeetingBot({
        sessionUser: {
          id: "user_123",
          email: "test@iosg.vc",
          name: null,
        },
        meetingUrl: "https://zoom.us/j/8436420171",
        platform: "zoom",
        now: new Date("2026-07-11T02:00:00.000Z"),
      }),
    ).resolves.toEqual({
      meetingId: "44444444-4444-4444-8444-444444444444",
      teamId: "22222222-2222-4222-8222-222222222222",
      startAt: "2026-07-11T02:20:00.000Z",
    });

    expect(meetingValues).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarEventId: "33333333-3333-4333-8333-333333333333",
        title: "Kimpton <> IOSG",
      }),
    );
  });
});
