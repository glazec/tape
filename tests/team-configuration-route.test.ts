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
  form.set("translationLanguage", "en");

  return new Request("https://app.example.com/settings/team", {
    body: form,
    method: "POST",
  });
}

describe("POST /api/team/configuration", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
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
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tape.example.com");
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
    expect(response.headers.get("location")).toBe(
      "https://tape.example.com/settings/team",
    );
    expect(updateTeamConfiguration).toHaveBeenCalledWith({
      name: "Example Capital",
      shareAudienceEmails: "partner@example.com",
      shareAudienceName: "Investment committee",
      teamId: "team_123",
      translationLanguage: "en",
    });
  });
});
