import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  getWorkspace,
  insert,
  onConflictDoNothing,
  select,
  values,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  insert: vi.fn(),
  onConflictDoNothing: vi.fn(),
  select: vi.fn(),
  values: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
  },
}));

async function shareMeetingRequest(body: unknown = { email: "teammate@example.com" }) {
  const { POST } = await import("@/app/api/meetings/[meetingId]/share/route");

  return POST(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/share",
      {
        body: JSON.stringify(body),
        method: "POST",
      },
    ),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

function mockMeetingRows(rows: Array<{ id: string }>) {
  select.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

function mockTargetRows(
  rows: Array<{ id: string; email: string; name: string | null }>,
) {
  select.mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  });
}

describe("POST /api/meetings/[meetingId]/share", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    insert.mockReset();
    onConflictDoNothing.mockReset();
    select.mockReset();
    values.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await shareMeetingRequest();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("shares an authenticated workspace meeting with a teammate", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([{ id: "11111111-1111-4111-8111-111111111111" }]);
    mockTargetRows([
      {
        email: "teammate@example.com",
        id: "teammate_user_id",
        name: "Team Mate",
      },
    ]);
    insert.mockReturnValue({ values });
    values.mockReturnValue({ onConflictDoNothing });
    onConflictDoNothing.mockResolvedValue(undefined);

    const response = await shareMeetingRequest({
      email: " Teammate@Example.com ",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      shared: true,
      user: {
        email: "teammate@example.com",
        name: "Team Mate",
      },
    });
    expect(values).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      role: "shared",
      userId: "teammate_user_id",
    });
    expect(onConflictDoNothing).toHaveBeenCalled();
  });

  it("rejects coworkers outside the current team", async () => {
    getCurrentUser.mockResolvedValue({
      email: "owner@example.com",
      id: "auth_owner",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      teamId: "team_123",
      userId: "owner_user_id",
    });
    mockMeetingRows([{ id: "11111111-1111-4111-8111-111111111111" }]);
    mockTargetRows([]);

    const response = await shareMeetingRequest({
      email: "outside@example.com",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Coworker must be a member of this team first.",
    });
    expect(insert).not.toHaveBeenCalled();
  });
});
