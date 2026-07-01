import { afterEach, describe, expect, it, vi } from "vitest";

const {
  insert,
  onConflictDoNothing,
  onConflictDoUpdate,
  select,
  set,
  update,
  values,
  where,
} = vi.hoisted(() => ({
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

  it("grants pending meeting shares when an invited email signs in", async () => {
    mockLimitedSelect([{ id: "user_123" }]);
    update.mockReturnValueOnce({ set });
    set.mockReturnValueOnce({ where });
    where.mockResolvedValueOnce(undefined);
    mockLimitedSelect([{ teamId: "team_123" }]);
    mockLimitedSelect([
      {
        id: "invite_123",
        meetingId: "meeting_123",
        role: "shared",
      },
    ]);
    insert.mockReturnValueOnce({ values });
    values.mockReturnValueOnce({ onConflictDoNothing });
    onConflictDoNothing.mockResolvedValueOnce(undefined);
    update.mockReturnValueOnce({ set });
    set.mockReturnValueOnce({ where });
    where.mockResolvedValueOnce(undefined);
    insert.mockReturnValueOnce({ values });
    values.mockReturnValueOnce({ onConflictDoUpdate });
    onConflictDoUpdate.mockResolvedValueOnce(undefined);

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
    expect(values).toHaveBeenCalledWith({
      meetingId: "meeting_123",
      role: "shared",
      userId: "user_123",
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.any(Array),
      set: {
        role: "member",
        updatedAt: expect.any(Date),
      },
    });
  });

  it("creates a read only guest workspace for unknown outside domains after bootstrap", async () => {
    mockLimitedSelect([{ id: "user_456" }]);
    update.mockReturnValueOnce({ set });
    set.mockReturnValueOnce({ where });
    where.mockResolvedValueOnce(undefined);
    mockLimitedSelect([]);
    mockLimitedSelect([]);
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
});
