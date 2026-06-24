import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createReadUrl,
  findRecallRecordingMediaUrl,
  getCurrentUser,
  getWorkspace,
  limit,
  retrieveRecallBot,
} = vi.hoisted(() => ({
    createReadUrl: vi.fn(),
    findRecallRecordingMediaUrl: vi.fn(),
    getCurrentUser: vi.fn(),
    getWorkspace: vi.fn(),
    limit: vi.fn(),
    retrieveRecallBot: vi.fn(),
  }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/r2", () => ({
  createReadUrl,
}));

vi.mock("@/lib/vendors/recall", () => ({
  findRecallRecordingMediaUrl,
  retrieveRecallBot,
}));

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit,
            }),
          }),
        }),
      }),
    }),
  },
}));

async function getMeetingAudio() {
  const { GET } = await import("@/app/api/meetings/[meetingId]/audio/route");

  return GET(
    new Request(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio",
    ),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

describe("GET /api/meetings/[meetingId]/audio", () => {
  afterEach(() => {
    createReadUrl.mockReset();
    findRecallRecordingMediaUrl.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    limit.mockReset();
    retrieveRecallBot.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await getMeetingAudio();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(createReadUrl).not.toHaveBeenCalled();
  });

  it("redirects authenticated workspace users to a signed audio URL", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([{ objectKey: "users/user_123/uploads/audio.mp3" }]);
    createReadUrl.mockResolvedValue("https://r2.example.com/audio.mp3");

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://r2.example.com/audio.mp3",
    );
    expect(createReadUrl).toHaveBeenCalledWith({
      key: "users/user_123/uploads/audio.mp3",
    });
    expect(retrieveRecallBot).not.toHaveBeenCalled();
  });

  it("redirects Recall recordings to the vendor audio URL when no R2 asset exists", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: "bot_123",
        recallRecordingId: "recording_123",
      },
    ]);
    retrieveRecallBot.mockResolvedValue({ recordings: [] });
    findRecallRecordingMediaUrl.mockReturnValue(
      "https://recall.example.com/audio.mp3",
    );

    const response = await getMeetingAudio();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://recall.example.com/audio.mp3",
    );
    expect(createReadUrl).not.toHaveBeenCalled();
    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(findRecallRecordingMediaUrl).toHaveBeenCalledWith(
      { recordings: [] },
      "recording_123",
    );
  });

  it("returns 404 when a Recall recording has no playable media URL", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    limit.mockResolvedValue([
      {
        objectKey: null,
        recallBotId: "bot_123",
        recallRecordingId: "recording_123",
      },
    ]);
    retrieveRecallBot.mockResolvedValue({ recordings: [] });
    findRecallRecordingMediaUrl.mockReturnValue(null);

    const response = await getMeetingAudio();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Audio not found",
    });
  });
});
