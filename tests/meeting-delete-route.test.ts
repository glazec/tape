import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, limit, deleteMeeting, where } =
  vi.hoisted(() => ({
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    limit: vi.fn(),
    deleteMeeting: vi.fn(),
    where: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit,
        }),
      }),
    }),
    delete: deleteMeeting,
  },
}));

async function deleteMeetingRequest() {
  const { DELETE } = await import("@/app/api/meetings/[meetingId]/route");

  return DELETE(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111",
      { method: "DELETE" },
    ),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

describe("DELETE /api/meetings/[meetingId]", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    deleteMeeting.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await deleteMeetingRequest();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(deleteMeeting).not.toHaveBeenCalled();
  });

  it("deletes an authenticated workspace meeting", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    deleteMeeting.mockReturnValue({ where });
    where.mockResolvedValue(undefined);

    const response = await deleteMeetingRequest();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true });
    expect(deleteMeeting).toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
  });
});
