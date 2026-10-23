import { beforeEach, describe, expect, it, vi } from "vitest";
const { getCurrentUser, getWorkspace, canManageTeamSettings, selectOrganizationWorkspace } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), getWorkspace: vi.fn(), canManageTeamSettings: vi.fn(), selectOrganizationWorkspace: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: getWorkspace, canManageTeamSettings }));
vi.mock("@/lib/organization-workspaces", () => ({ selectOrganizationWorkspace }));
import { getAdminTeamSettingsWorkspace } from "@/lib/team-settings-access";
const selected = { teamId: "second", userId: "user", domain: "second.example" };
beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "auth", email: "user@first.example" });
  getWorkspace.mockResolvedValue({ teamId: "first", userId: "user", domain: "first.example" });
});
describe("organization settings authorization", () => {
  it("checks administration of the organization being edited", async () => {
    selectOrganizationWorkspace.mockResolvedValue(selected);
    canManageTeamSettings.mockResolvedValue(true);
    expect(await getAdminTeamSettingsWorkspace(new Request("https://app.example/api/team/bot-profile?teamId=second"))).toEqual(selected);
    expect(canManageTeamSettings).toHaveBeenCalledWith(selected);
  });
  it("blocks a member of the selected organization even if their home organization is different", async () => {
    selectOrganizationWorkspace.mockResolvedValue(selected);
    canManageTeamSettings.mockResolvedValue(false);
    const result = await getAdminTeamSettingsWorkspace(new Request("https://app.example/api/team/bot-profile?teamId=second"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });
  it("blocks an unrelated organization before checking admin permissions", async () => {
    selectOrganizationWorkspace.mockResolvedValue(null);
    const result = await getAdminTeamSettingsWorkspace(new Request("https://app.example/api/team/bot-profile?teamId=unrelated"));
    expect((result as Response).status).toBe(403);
    expect(canManageTeamSettings).not.toHaveBeenCalled();
  });
});
