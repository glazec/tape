import { afterEach, describe, expect, it, vi } from "vitest";

const {
  canManageTeamSettings,
  deleteTerms,
  getCurrentUser,
  getWorkspace,
  insert,
} = vi.hoisted(() => ({
  canManageTeamSettings: vi.fn(),
  deleteTerms: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { delete: deleteTerms, insert },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  canManageTeamSettings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/organization-workspaces", () => ({ selectOrganizationWorkspace: vi.fn() }));

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
    expect(response.headers.get("location")).toBe("/settings/team?teamId=team_123");
    expect(values).toHaveBeenCalledWith({
      teamId: "team_123",
      term: "TCG platform",
      hint: "Trading card game",
      enabled: true,
    });
  });
});

describe("DELETE /api/team/vocabulary", () => {
  const termId = "33333333-3333-4333-8333-333333333333";

  function signInAs({ admin }: { admin: boolean }) {
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
    canManageTeamSettings.mockResolvedValue(admin);
  }

  function mockDelete(rows: Array<{ id: string }>) {
    const returning = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ returning });
    deleteTerms.mockReturnValue({ where });
    return where;
  }

  afterEach(() => {
    getCurrentUser.mockReset();
    canManageTeamSettings.mockReset();
    getWorkspace.mockReset();
    deleteTerms.mockReset();
    vi.resetModules();
  });

  it("removes a term from the admin's team", async () => {
    signInAs({ admin: true });
    const where = mockDelete([{ id: termId }]);
    const { DELETE } = await import("@/app/api/team/vocabulary/route");

    const response = await DELETE(
      new Request(`https://tape.test/api/team/vocabulary?termId=${termId}`, {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(204);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("reports a term that is not in the team", async () => {
    signInAs({ admin: true });
    mockDelete([]);
    const { DELETE } = await import("@/app/api/team/vocabulary/route");

    const response = await DELETE(
      new Request(`https://tape.test/api/team/vocabulary?termId=${termId}`, {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects a missing or malformed term id", async () => {
    signInAs({ admin: true });
    const { DELETE } = await import("@/app/api/team/vocabulary/route");

    const response = await DELETE(
      new Request("https://tape.test/api/team/vocabulary?termId=not-a-uuid", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(400);
    expect(deleteTerms).not.toHaveBeenCalled();
  });

  it("blocks ordinary members", async () => {
    signInAs({ admin: false });
    const { DELETE } = await import("@/app/api/team/vocabulary/route");

    const response = await DELETE(
      new Request(`https://tape.test/api/team/vocabulary?termId=${termId}`, {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(403);
    expect(deleteTerms).not.toHaveBeenCalled();
  });
});
