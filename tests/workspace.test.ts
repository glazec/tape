import { afterEach, describe, expect, it, vi } from "vitest";

const {
  execute,
  insert,
  onConflictDoNothing,
  onConflictDoUpdate,
  select,
  set,
  update,
  values,
  where,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  insert: vi.fn(),
  onConflictDoNothing: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  select: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    execute,
    select,
    update,
  },
}));

function mockLimitedSelect(rows: unknown[]) {
  select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

function mockSelectLimit(rows: unknown[]) {
  select.mockReturnValueOnce({
    from: () => ({
      limit: vi.fn().mockResolvedValue(rows),
    }),
  });
}

describe("getOrCreateWorkspaceForSessionUser", () => {
  afterEach(() => {
    execute.mockReset();
    insert.mockReset();
    onConflictDoNothing.mockReset();
    onConflictDoUpdate.mockReset();
    select.mockReset();
    set.mockReset();
    update.mockReset();
    values.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("claims every pending meeting share in one pass", async () => {
    execute.mockResolvedValue(undefined);
    const { grantPendingMeetingShares } = await import("@/lib/workspace");

    await grantPendingMeetingShares("user_123", "guest@example.com");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("grants pending meeting shares when an invited email signs in", async () => {
    mockLimitedSelect([{ id: "user_123" }]);
    update.mockReturnValueOnce({ set });
    set.mockReturnValueOnce({ where });
    where.mockResolvedValueOnce(undefined);
    mockLimitedSelect([{ teamId: "team_123" }]);
    execute.mockResolvedValueOnce(undefined);
    insert.mockReturnValueOnce({ values });
    values.mockReturnValueOnce({ onConflictDoNothing });
    onConflictDoNothing.mockResolvedValueOnce(undefined);

    const { getOrCreateWorkspaceForSessionUser } = await import(
      "@/lib/workspace"
    );

    await expect(
      getOrCreateWorkspaceForSessionUser({
        email: " Partner@Vendor.com ",
        id: "auth_123",
        name: "Partner",
      }),
    ).resolves.toEqual({
      canCreateMeetings: true,
      domain: "vendor.com",
      teamId: "team_123",
      userId: "user_123",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("creates a read only guest workspace for unknown outside domains after bootstrap", async () => {
    mockLimitedSelect([{ id: "user_456" }]);
    update.mockReturnValueOnce({ set });
    set.mockReturnValueOnce({ where });
    where.mockResolvedValueOnce(undefined);
    mockLimitedSelect([]);
    execute.mockResolvedValueOnce(undefined);
    mockLimitedSelect([]);
    mockSelectLimit([{ id: "allowed_domain_123" }]);
    insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "guest_team_123" }]),
      }),
    });
    insert.mockReturnValueOnce({ values });
    values.mockReturnValueOnce({ onConflictDoNothing });
    onConflictDoNothing.mockResolvedValueOnce(undefined);

    const { getOrCreateWorkspaceForSessionUser } = await import(
      "@/lib/workspace"
    );

    await expect(
      getOrCreateWorkspaceForSessionUser({
        email: "guest@vendor.com",
        id: "auth_456",
        name: "Guest",
      }),
    ).resolves.toEqual({
      canCreateMeetings: false,
      domain: "vendor.com",
      teamId: "guest_team_123",
      userId: "user_456",
    });
    expect(values).toHaveBeenLastCalledWith({
      role: "external",
      teamId: "guest_team_123",
      userId: "user_456",
    });
  });

  it("lists onboarded workspace members with the current user marked", async () => {
    const orderBy = vi.fn().mockResolvedValue([
      {
        email: "member@iosg.vc",
        id: "user_123",
        joinedAt: new Date("2026-06-29T12:00:00.000Z"),
        name: "Member",
        role: "member",
      },
      {
        email: "alice@iosg.vc",
        id: "user_456",
        joinedAt: new Date("2026-06-30T12:00:00.000Z"),
        name: "Alice",
        role: "member",
      },
    ]);
    select.mockReturnValueOnce({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy,
          }),
        }),
      }),
    });

    const { listWorkspaceMembers } = await import("@/lib/workspace");

    await expect(
      listWorkspaceMembers({
        domain: "iosg.vc",
        teamId: "team_123",
        userId: "user_123",
      }),
    ).resolves.toEqual([
      {
        email: "member@iosg.vc",
        id: "user_123",
        isCurrentUser: true,
        joinedAt: new Date("2026-06-29T12:00:00.000Z"),
        name: "Member",
        role: "member",
      },
      {
        email: "alice@iosg.vc",
        id: "user_456",
        isCurrentUser: false,
        joinedAt: new Date("2026-06-30T12:00:00.000Z"),
        name: "Alice",
        role: "member",
      },
    ]);
  });
});
