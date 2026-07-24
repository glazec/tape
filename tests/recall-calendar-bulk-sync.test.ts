import { afterEach, describe, expect, it, vi } from "vitest";

const { select, syncRecallCalendarEventsForWorkspace } = vi.hoisted(() => ({
  select: vi.fn(),
  syncRecallCalendarEventsForWorkspace: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

vi.mock("@/lib/recall-calendar", () => ({
  syncRecallCalendarEventsForWorkspace,
}));

function mockConnectedCalendarRows(rows: unknown[]) {
  select.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

describe("syncRecallCalendarEventsForAllConnectedUsers", () => {
  afterEach(() => {
    select.mockReset();
    syncRecallCalendarEventsForWorkspace.mockReset();
    vi.resetModules();
  });

  it("syncs every connected Recall calendar with the owning workspace", async () => {
    const now = new Date("2026-06-30T06:00:00.000Z");
    mockConnectedCalendarRows([
      {
        connectionId: "connection_1",
        creditLimitUsdMicros: null,
        teamId: "team_1",
        userId: "user_1",
        userEmail: "Alice@IOSG.VC",
        autoJoinEnabled: true,
      },
      {
        connectionId: "connection_2",
        creditLimitUsdMicros: 5_000_000,
        teamId: "team_2",
        userId: "user_2",
        userEmail: "bob@example.com",
        autoJoinEnabled: false,
      },
    ]);
    syncRecallCalendarEventsForWorkspace
      .mockResolvedValueOnce({ syncedEventCount: 3 })
      .mockResolvedValueOnce({ syncedEventCount: 5 });

    const { syncRecallCalendarEventsForAllConnectedUsers } = await import(
      "@/lib/recall-calendar-bulk-sync"
    );

    await expect(
      syncRecallCalendarEventsForAllConnectedUsers({ now }),
    ).resolves.toEqual({
      connectionCount: 2,
      failedConnectionCount: 0,
      failures: [],
      syncedConnectionCount: 2,
      syncedEventCount: 8,
    });
    expect(syncRecallCalendarEventsForWorkspace).toHaveBeenNthCalledWith(1, {
      workspace: {
        creditLimitUsdMicros: null,
        domain: "iosg.vc",
        teamId: "team_1",
        userId: "user_1",
      },
      autoJoinEnabled: true,
      now,
    });
    expect(syncRecallCalendarEventsForWorkspace).toHaveBeenNthCalledWith(2, {
      workspace: {
        creditLimitUsdMicros: 5_000_000,
        domain: "example.com",
        teamId: "team_2",
        userId: "user_2",
      },
      autoJoinEnabled: false,
      now,
    });
  });

  it("keeps syncing other users and reports a failed run when one connected calendar fails", async () => {
    mockConnectedCalendarRows([
      {
        connectionId: "connection_1",
        creditLimitUsdMicros: null,
        teamId: "team_1",
        userId: "user_1",
        userEmail: "alice@iosg.vc",
        autoJoinEnabled: true,
      },
      {
        connectionId: "connection_2",
        creditLimitUsdMicros: 5_000_000,
        teamId: "team_2",
        userId: "user_2",
        userEmail: "bob@example.com",
        autoJoinEnabled: true,
      },
    ]);
    syncRecallCalendarEventsForWorkspace
      .mockRejectedValueOnce(new Error("Recall unavailable"))
      .mockResolvedValueOnce({ syncedEventCount: 4 });

    const { syncRecallCalendarEventsForAllConnectedUsers } = await import(
      "@/lib/recall-calendar-bulk-sync"
    );

    const expectedResult = {
      connectionCount: 2,
      failedConnectionCount: 1,
      failures: [
        {
          connectionId: "connection_1",
          error: "Recall unavailable",
        },
      ],
      syncedConnectionCount: 1,
      syncedEventCount: 4,
    };

    await expect(
      syncRecallCalendarEventsForAllConnectedUsers(),
    ).rejects.toMatchObject({
      message: "Recall calendar sync failed for 1 of 2 connections",
      result: expectedResult,
    });
    expect(syncRecallCalendarEventsForWorkspace).toHaveBeenCalledTimes(2);
  });
});
