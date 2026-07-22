import { getCurrentUser } from "@/lib/auth";
import {
  canManageTeamSettings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export async function getAdminTeamSettingsWorkspace() {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);

  if (!(await canManageTeamSettings(workspace))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return workspace;
}
