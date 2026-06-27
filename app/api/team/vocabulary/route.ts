import { db } from "@/db/client";
import { teamVocabularyTerms } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
} from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const term = normalizeFormValue(formData?.get("term"));
  const hint = normalizeFormValue(formData?.get("hint"));

  if (!term) {
    return Response.json({ error: "Term is required" }, { status: 400 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);

  if (!accessSummary.canCreateMeetings) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await db
    .insert(teamVocabularyTerms)
    .values({
      teamId: workspace.teamId,
      term,
      hint,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [teamVocabularyTerms.teamId, teamVocabularyTerms.term],
      set: {
        hint,
        enabled: true,
        updatedAt: new Date(),
      },
    });

  return Response.redirect(new URL("/settings/team", request.url), 303);
}

function normalizeFormValue(value: FormDataEntryValue | null | undefined) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim() || null
    : null;
}
