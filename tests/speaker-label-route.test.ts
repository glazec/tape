import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, limit, set, where } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  limit: vi.fn(),
  set: vi.fn(),
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
    update: () => ({
      set,
    }),
  },
}));

async function patchSpeakerLabel(body: unknown) {
  const { PATCH } = await import("@/app/api/meetings/[meetingId]/speakers/route");

  return PATCH(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/speakers",
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
      },
    ),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

describe("PATCH /api/meetings/[meetingId]/speakers", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    set.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("renames unknown speaker labels for an authenticated workspace meeting", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ id: "11111111-1111-4111-8111-111111111111" }]);
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);

    const response = await patchSpeakerLabel({
      currentSpeaker: null,
      speaker: "Alice",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      updated: true,
      speaker: "Alice",
    });
    expect(set).toHaveBeenCalledWith({
      speaker: "Alice",
      updatedAt: expect.any(Date),
    });
  });

  it("rejects blank replacement labels", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await patchSpeakerLabel({
      currentSpeaker: null,
      speaker: " ",
    });

    expect(response.status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });
});
