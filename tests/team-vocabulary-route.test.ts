import { afterEach, describe, expect, it, vi } from "vitest";

const {
  canManageTeamSettings,
  getCurrentUser,
  getWorkspace,
  insert,
} = vi.hoisted(() => ({
  canManageTeamSettings: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  canManageTeamSettings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

describe("POST /api/team/vocabulary", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    canManageTeamSettings.mockReset();
    getWorkspace.mockReset();
    insert.mockReset();
    vi.resetModules();
  });

  it("blocks ordinary members from changing team vocabulary", async () => {
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
    canManageTeamSettings.mockResolvedValue(false);
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

    expect(response.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it("allows team administrators to change team vocabulary", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "admin@iosg.vc",
      name: "Admin",
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });
    canManageTeamSettings.mockResolvedValue(true);
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    insert.mockReturnValue({ values });

    const { POST } = await import("@/app/api/team/vocabulary/route");
    const form = new FormData();
    form.set("term", "TCG platform");
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
