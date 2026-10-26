import { beforeEach, describe, expect, it, vi } from "vitest";

const { listOrganizationWorkspaces, getOrganizationBotSettings, getMeetingBotProfile, selectOrganizationWorkspace } = vi.hoisted(() => ({
  listOrganizationWorkspaces: vi.fn(), getOrganizationBotSettings: vi.fn(),
  getMeetingBotProfile: vi.fn(), selectOrganizationWorkspace: vi.fn(),
}));
vi.mock("@/lib/organization-workspaces", () => ({ listOrganizationWorkspaces, getOrganizationBotSettings, selectOrganizationWorkspace }));
vi.mock("@/lib/meeting-bot-profile", () => ({ getMeetingBotProfile }));
import { listMeetingBotChoices, selectMeetingBotChoice } from "@/lib/meeting-bot-selection";

const workspace = { teamId: "company", userId: "user", domain: "first.test", canCreateMeetings: true };
beforeEach(() => {
  vi.resetAllMocks();
  listOrganizationWorkspaces.mockResolvedValue([{ ...workspace, teamName: "Company" }]);
  getOrganizationBotSettings.mockResolvedValue({ domains: ["first.test", "second.test"] });
  getMeetingBotProfile.mockImplementation(async (_teamId, domain) => ({ botName: domain === "second.test" ? "Second bot" : "First bot", avatarJpegBase64: "private-image" }));
  selectOrganizationWorkspace.mockImplementation(async (value, teamId) => ({ ...value, teamId }));
});
describe("meeting bot organization choices", () => {
  it("offers both organization identities even when they share one workspace", async () => {
    expect(await listMeetingBotChoices(workspace)).toEqual([
      { teamId: "company", teamName: "Company", organizationDomain: "first.test", botName: "First bot" },
      { teamId: "company", teamName: "Company", organizationDomain: "second.test", botName: "Second bot" },
    ]);
  });
  it("requires a choice when multiple bots exist instead of using the login domain", async () => {
    expect(await selectMeetingBotChoice(workspace, {})).toMatchObject({ choices: expect.any(Array) });
    expect(selectOrganizationWorkspace).not.toHaveBeenCalled();
  });
  it("uses the explicitly selected organization", async () => {
    expect(await selectMeetingBotChoice(workspace, { teamId: "company", organizationDomain: "second.test" })).toMatchObject({
      workspace: { teamId: "company", domain: "second.test" }, organizationDomain: "second.test",
    });
  });
  it("rejects a forged organization before selecting a workspace", async () => {
    await expect(selectMeetingBotChoice(workspace, { teamId: "stranger", organizationDomain: "second.test" })).rejects.toThrow("Organization unavailable");
    expect(selectOrganizationWorkspace).not.toHaveBeenCalled();
  });
  it("automatically uses the only available bot", async () => {
    getOrganizationBotSettings.mockResolvedValue({ domains: ["first.test"] });
    expect(await selectMeetingBotChoice(workspace, {})).toMatchObject({ organizationDomain: "first.test" });
  });
});
