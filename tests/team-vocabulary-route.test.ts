import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  getWorkspace,
  getWorkspaceAccessSummary,
  insert,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
  getWorkspaceAccessSummary,
}));

describe("POST /api/team/vocabulary", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    getWorkspaceAccessSummary.mockReset();
    insert.mockReset();
    vi.resetModules();
  });

  it("adds a team vocabulary term for internal members", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: "Member",
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    insert.mockReturnValue({ values });

    const { POST } = await import("@/app/api/team/vocabulary/route");
    const form = new FormData();
    form.set("term", " TCG platform ");
    form.set("hint", "Trading card game");

    const response = await POST(new Request("https://app.example.com", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(303);
    expect(values).toHaveBeenCalledWith({
      teamId: "team_123",
      term: "TCG platform",
      hint: "Trading card game",
      enabled: true,
    });
  });
});
