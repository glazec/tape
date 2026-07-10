import { afterEach, describe, expect, it, vi } from "vitest";

const { assertCanCreateMeetings, getOrCreateWorkspaceForSessionUser, insert, select, update } =
  vi.hoisted(() => ({
    assertCanCreateMeetings: vi.fn(),
    getOrCreateWorkspaceForSessionUser: vi.fn(),
    insert: vi.fn(),
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
    select.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("links a manual meeting URL to an upcoming calendar event", async () => {
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
    });

    expect(meetingValues).toHaveBeenCalledWith({
      teamId: "22222222-2222-4222-8222-222222222222",
      ownerUserId: "55555555-5555-4555-8555-555555555555",
      calendarEventId: "33333333-3333-4333-8333-333333333333",
      title: "AI Training",
      platform: "zoom",
      status: "scheduled",
      meetingUrl: "https://zoom.us/j/8851797582",
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
});
