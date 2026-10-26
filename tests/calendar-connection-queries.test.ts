import { afterEach, describe, expect, it, vi } from "vitest";

const { ensureRecallManagedCalendarConnectionForWorkspace, getWorkspace, select } =
  vi.hoisted(() => ({
    ensureRecallManagedCalendarConnectionForWorkspace: vi.fn(),
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

vi.mock("@/lib/recall-calendar", () => ({
  ensureRecallManagedCalendarConnectionForWorkspace,
}));

describe("getCalendarConnectionSummary", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    ensureRecallManagedCalendarConnectionForWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("exposes each account instead of choosing an arbitrary connected account", async () => {
    getWorkspace.mockResolvedValue({ teamId: "team", userId: "user", domain: "example.com" });
    const accounts = ["first@example.com", "second@example.com"].map((accountEmail, index) => ({
      connectionId: `connection-${index}`, accountEmail, autoJoinEnabled: true,
      recallCalendarId: `calendar-${index}`, recallCalendarStatus: index ? "disconnected" : "connected", recallCalendarLastSyncedAt: null,
    }));
    select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => accounts }) }) });
    const { getCalendarConnectionSummary } = await import("@/lib/calendar-connection-queries");
    const summary = await getCalendarConnectionSummary({ id: "auth", email: "first@example.com", name: null });
    expect(summary.connectionId).toBeUndefined();
    expect(summary.accounts?.map((account) => [account.teamId, account.connectionId, account.accountEmail])).toEqual([
      ["team", "connection-0", "first@example.com"], ["team", "connection-1", "second@example.com"],
    ]);
    expect(ensureRecallManagedCalendarConnectionForWorkspace).not.toHaveBeenCalled();
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
    ensureRecallManagedCalendarConnectionForWorkspace.mockResolvedValue(null);

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
    ensureRecallManagedCalendarConnectionForWorkspace.mockResolvedValue(null);

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

  it("returns an adopted Recall Calendar summary when Recall already owns the connection", async () => {
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
    ensureRecallManagedCalendarConnectionForWorkspace.mockResolvedValue({
      id: "adopted-connection",
      accountEmail: "alice@example.com",
      autoJoinEnabled: true,
      recallCalendarId: "44444444-4444-4444-8444-444444444444",
      recallCalendarStatus: "connected",
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
      teamId: "22222222-2222-4222-8222-222222222222",
      connectionId: "adopted-connection",
      accountEmail: "alice@example.com",
      connected: true,
      autoJoinEnabled: true,
      recallCalendarStatus: "connected",
      recallCalendarLastSyncedAt: null,
    });
  });
});
