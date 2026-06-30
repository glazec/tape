import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, limit, send, set, where } = vi.hoisted(
  () => ({
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    limit: vi.fn(),
    send: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send,
  },
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

async function requestTranslation() {
  const { POST } = await import(
    "@/app/api/meetings/[meetingId]/translation/route"
  );

  return POST(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/translation",
      {
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

describe("POST /api/meetings/[meetingId]/translation", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    send.mockReset();
    set.mockReset();
    where.mockReset();
    vi.resetModules();
  });

  it("queues translation for a workspace meeting with transcript lines", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit
      .mockResolvedValueOnce([{ id: "11111111-1111-4111-8111-111111111111" }])
      .mockResolvedValueOnce([{ id: "22222222-2222-4222-8222-222222222222" }]);
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
    send.mockResolvedValue(undefined);

    const response = await requestTranslation();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(set).toHaveBeenCalledWith({
      translationCompletedAt: null,
      translationErrorMessage: null,
      translationStatus: "queued",
      updatedAt: expect.any(Date),
    });
    expect(send).toHaveBeenCalledWith({
      name: "meeting/enrich.transcript",
      data: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        translateToChinese: true,
      },
    });
  });
});
