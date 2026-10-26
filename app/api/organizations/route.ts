import { cookies } from "next/headers";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { listOrganizationWorkspaces, selectOrganizationWorkspace } from "@/lib/organization-workspaces";
import { ORGANIZATION_COOKIE } from "@/lib/selected-organization";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  return Response.json({
    teamId: workspace.teamId,
    organizations: (await listOrganizationWorkspaces(workspace)).map(({ teamId, teamName }) => ({ teamId, teamName })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.strictObject({ teamId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid organization" }, { status: 400 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  // Check membership even when the requested organization is already active.
  const organizations = await listOrganizationWorkspaces(workspace);
  if (!organizations.some((organization) => organization.teamId === parsed.data.teamId) ||
      !await selectOrganizationWorkspace(workspace, parsed.data.teamId)) {
    return Response.json({ error: "Organization unavailable" }, { status: 403 });
  }
  (await cookies()).set(ORGANIZATION_COOKIE, parsed.data.teamId, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ teamId: parsed.data.teamId });
}
