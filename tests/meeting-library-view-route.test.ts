import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  getWorkspace,
  saveDefaultMeetingLibraryView,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  saveDefaultMeetingLibraryView: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/meeting-library-views", () => ({
  saveDefaultMeetingLibraryView,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

describe("POST /api/meeting-library-view", () => {
  afterEach(() => {
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    saveDefaultMeetingLibraryView.mockReset();
    vi.resetModules();
  });

  it("saves the current meeting library controls as the user's default view", async () => {
    getCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });
    saveDefaultMeetingLibraryView.mockResolvedValue(undefined);
    const form = new FormData();
    form.set("q", " Alice ");
    form.set("scope", "participants");
    form.set("status", "ready");
    form.set("sort", "duration_desc");

    const { POST } = await import("@/app/api/meeting-library-view/route");
    const response = await POST(
      new Request("https://app.example.com/api/meeting-library-view", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/dashboard?view=my",
    );
    expect(saveDefaultMeetingLibraryView).toHaveBeenCalledWith({
      workspace: {
        userId: "user_123",
        teamId: "team_123",
        domain: "iosg.vc",
        canCreateMeetings: true,
      },
      config: {
        query: "Alice",
        searchScope: "participants",
        status: "ready",
        sort: "duration_desc",
      },
    });
  });

  it("redirects unauthenticated users to sign in", async () => {
    getCurrentUser.mockResolvedValue(null);

    const { POST } = await import("@/app/api/meeting-library-view/route");
    const response = await POST(
      new Request("https://app.example.com/api/meeting-library-view", {
        method: "POST",
        body: new FormData(),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/auth/sign-in",
    );
    expect(saveDefaultMeetingLibraryView).not.toHaveBeenCalled();
  });
});
