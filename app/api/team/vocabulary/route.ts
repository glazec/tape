import { db } from "@/db/client";
import { teamVocabularyTerms } from "@/db/schema";
import { getNormalizedStringFormValue } from "@/lib/form-data";
import { getAdminTeamSettingsWorkspace } from "@/lib/team-settings-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workspace = await getAdminTeamSettingsWorkspace();

  if (workspace instanceof Response) {
    return workspace;
  }

  const formData = await request.formData().catch(() => null);
  const term = getNormalizedStringFormValue(formData, "term");
  const hint = getNormalizedStringFormValue(formData, "hint");

  if (!term) {
    return Response.json({ error: "Term is required" }, { status: 400 });
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
