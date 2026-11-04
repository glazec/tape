import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { intelSearches } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
export async function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.NEXT_PUBLIC_APP_URL || request.url).origin) return Response.json({ error: "Forbidden" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  await db.delete(intelSearches).where(and(eq(intelSearches.teamId, workspace.teamId), eq(intelSearches.userId, workspace.userId)));
  return Response.json({ cleared: true });
}
