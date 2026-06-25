import { afterEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, getWorkspace, select } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

async function getMeetingExport(
  url = "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/export",
) {
  const { GET } = await import("@/app/api/meetings/[meetingId]/export/route");

  return GET(
    new Request(url),
    {
      params: Promise.resolve({
        meetingId: "11111111-1111-4111-8111-111111111111",
      }),
    },
  );
}

describe("GET /api/meetings/[meetingId]/export", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    select.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await getMeetingExport();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(select).not.toHaveBeenCalled();
  });

  it("exports transcript text for an authenticated workspace meeting", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });

    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Nascent Sync",
              },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([
              {
                speaker: "Speaker 1",
                startMs: 20000,
                text: "First line.",
              },
              {
                speaker: null,
                startMs: 80500,
                text: "Second line.",
              },
            ]),
          }),
        }),
      });

    const response = await getMeetingExport();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-disposition")).toContain(
      "Nascent Sync transcript.txt",
    );
    await expect(response.text()).resolves.toContain(
      "[0:20] Speaker 1: First line.",
    );
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("redirects MP3 exports to the authenticated meeting audio route", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await getMeetingExport(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/export?format=mp3",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/api/meetings/11111111-1111-4111-8111-111111111111/audio?download=1",
    );
    expect(select).not.toHaveBeenCalled();
  });
});
