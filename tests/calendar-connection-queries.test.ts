import { afterEach, describe, expect, it, vi } from "vitest";

const { getWorkspace, select } = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

describe("getCalendarConnectionSummary", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("returns a connected Recall Calendar summary from Neon", async () => {
    getWorkspace.mockResolvedValue({
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "11111111-1111-4111-8111-111111111111",
      domain: "example.com",
    });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              autoJoinEnabled: true,
              recallCalendarId: "44444444-4444-4444-8444-444444444444",
              recallCalendarStatus: "connected",
              recallCalendarLastSyncedAt: new Date("2026-06-27T12:00:00.000Z"),
            },
          ]),
        }),
      }),
    });

    const { getCalendarConnectionSummary } = await import(
      "@/lib/calendar-connection-queries"
    );

    await expect(
      getCalendarConnectionSummary({
        id: "auth_user_123",
        email: "alice@example.com",
        name: null,
      }),
    ).resolves.toEqual({
      connected: true,
      autoJoinEnabled: true,
      recallCalendarStatus: "connected",
      recallCalendarLastSyncedAt: "2026-06-27T12:00:00.000Z",
    });
  });

  it("returns a disconnected summary when no connection exists", async () => {
    getWorkspace.mockResolvedValue({
      teamId: "22222222-2222-4222-8222-222222222222",
      userId: "11111111-1111-4111-8111-111111111111",
      domain: "example.com",
    });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const { getCalendarConnectionSummary } = await import(
      "@/lib/calendar-connection-queries"
    );

    await expect(
      getCalendarConnectionSummary({
        id: "auth_user_123",
        email: "alice@example.com",
        name: null,
      }),
    ).resolves.toEqual({
      connected: false,
      autoJoinEnabled: false,
      recallCalendarStatus: null,
      recallCalendarLastSyncedAt: null,
    });
  });
});
