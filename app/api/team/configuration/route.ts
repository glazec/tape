import { getStringFormValue } from "@/lib/form-data";
import {
  TeamConfigurationInputError,
  updateTeamConfiguration,
} from "@/lib/team-configuration";
import { getAdminTeamSettingsWorkspace } from "@/lib/team-settings-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workspace = await getAdminTeamSettingsWorkspace();

  if (workspace instanceof Response) {
    return workspace;
  }

  const formData = await request.formData().catch(() => null);

  try {
    await updateTeamConfiguration({
      name: getStringFormValue(formData, "teamName"),
      shareAudienceEmails: getStringFormValue(formData, "shareAudienceEmails"),
      shareAudienceName: getStringFormValue(formData, "shareAudienceName"),
      teamId: workspace.teamId,
    });
  } catch (error) {
    if (error instanceof TeamConfigurationInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json(
      { error: "Team configuration could not be saved" },
      { status: 500 },
    );
  }

  return Response.redirect(new URL("/settings/team", request.url), 303);
}
