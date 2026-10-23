import { getCurrentUser } from "@/lib/auth";
import { selectOrganizationWorkspace } from "@/lib/organization-workspaces";
import {
  canManageTeamSettings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export async function getAdminTeamSettingsWorkspace(request?: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let workspace = await getOrCreateWorkspaceForSessionUser(user);
  const teamId = request && new URL(request.url).searchParams.get("teamId");
  if (teamId) {
    const selected = await selectOrganizationWorkspace(workspace, teamId);
    if (!selected) return Response.json({ error: "Forbidden" }, { status: 403 });
    workspace = selected;
  }

  if (!(await canManageTeamSettings(workspace))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return workspace;
}
