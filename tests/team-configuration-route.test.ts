import { afterEach, describe, expect, it, vi } from "vitest";

const {
  canManageTeamSettings,
  getCurrentUser,
  getWorkspace,
  updateTeamConfiguration,
} = vi.hoisted(() => ({
  canManageTeamSettings: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  updateTeamConfiguration: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({
  canManageTeamSettings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));
vi.mock("@/lib/team-configuration", () => ({
  TeamConfigurationInputError: class extends Error {},
  updateTeamConfiguration,
}));

function configurationRequest() {
  const form = new FormData();
  form.set("teamName", "Example Capital");
  form.set("shareAudienceName", "Investment committee");
  form.set("shareAudienceEmails", "partner@example.com");

  return new Request("https://app.example.com/settings/team", {
    body: form,
    method: "POST",
  });
}

describe("POST /api/team/configuration", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("blocks ordinary members", async () => {
    getCurrentUser.mockResolvedValue({
      email: "member@example.com",
      id: "auth_123",
      name: "Member",
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    canManageTeamSettings.mockResolvedValue(false);
    const { POST } = await import("@/app/api/team/configuration/route");

    const response = await POST(configurationRequest());

    expect(response.status).toBe(403);
    expect(updateTeamConfiguration).not.toHaveBeenCalled();
  });

  it("lets administrators save the configuration", async () => {
    getCurrentUser.mockResolvedValue({
      email: "admin@example.com",
      id: "auth_123",
      name: "Admin",
    });
    getWorkspace.mockResolvedValue({ teamId: "team_123" });
    canManageTeamSettings.mockResolvedValue(true);
    updateTeamConfiguration.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/team/configuration/route");

    const response = await POST(configurationRequest());

    expect(response.status).toBe(303);
    expect(updateTeamConfiguration).toHaveBeenCalledWith({
      name: "Example Capital",
      shareAudienceEmails: "partner@example.com",
      shareAudienceName: "Investment committee",
      teamId: "team_123",
    });
  });
});
