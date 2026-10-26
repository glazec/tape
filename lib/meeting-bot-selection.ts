import { getMeetingBotProfile } from "@/lib/meeting-bot-profile";
import {
  getOrganizationBotSettings,
  listOrganizationWorkspaces,
  selectOrganizationWorkspace,
} from "@/lib/organization-workspaces";
import type { WorkspaceContext } from "@/lib/workspace";

export type MeetingBotChoice = {
  teamId: string;
  teamName: string;
  organizationDomain: string;
  botName: string;
};

export class MeetingBotOrganizationError extends Error {}

export async function listMeetingBotChoices(workspace: WorkspaceContext): Promise<MeetingBotChoice[]> {
  const organizations = await listOrganizationWorkspaces(workspace);
  const choices: MeetingBotChoice[] = [];
  for (const organization of organizations) {
    const { domains } = await getOrganizationBotSettings(organization.teamId);
    for (const domain of domains.length ? domains : [""]) {
      const profile = await getMeetingBotProfile(organization.teamId, domain || undefined);
      choices.push({
        teamId: organization.teamId,
        teamName: organization.teamName,
        organizationDomain: domain,
        botName: profile.botName,
      });
    }
  }
  return choices;
}

export async function selectMeetingBotChoice(
  workspace: WorkspaceContext,
  input: { teamId?: string; organizationDomain?: string },
) {
  const choices = await listMeetingBotChoices(workspace);
  const explicitChoice = input.teamId !== undefined || input.organizationDomain !== undefined;
  const candidates = choices.filter((choice) =>
    (!input.teamId || choice.teamId === input.teamId) &&
    (input.organizationDomain === undefined || choice.organizationDomain === input.organizationDomain),
  );
  if (!candidates.length) throw new MeetingBotOrganizationError("Organization unavailable");
  if ((!explicitChoice && choices.length > 1) || candidates.length > 1) return { choices: candidates };
  const choice = candidates[0];
  const selected = await selectOrganizationWorkspace(workspace, choice.teamId);
  if (!selected) throw new MeetingBotOrganizationError("Organization unavailable");
  return { workspace: { ...selected, domain: choice.organizationDomain }, organizationDomain: choice.organizationDomain };
}
