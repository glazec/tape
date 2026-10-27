import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { teamVocabularyTerms } from "@/db/schema";
import { getNormalizedStringFormValue } from "@/lib/form-data";
import { redirectSeeOther } from "@/lib/http-responses";
import { getAdminTeamSettingsWorkspace } from "@/lib/team-settings-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const workspace = await getAdminTeamSettingsWorkspace(request);

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

  return redirectSeeOther(`/settings/team?teamId=${workspace.teamId}`);
}

export async function DELETE(request: Request) {
  const workspace = await getAdminTeamSettingsWorkspace(request);

  if (workspace instanceof Response) {
    return workspace;
  }

  const termId = new URL(request.url).searchParams.get("termId");

  if (!termId || !z.uuid().safeParse(termId).success) {
    return Response.json({ error: "Term is required" }, { status: 400 });
  }

  // Scoped to the admin's team, so a term id from another team removes nothing.
  const removed = await db
    .delete(teamVocabularyTerms)
    .where(
      and(
        eq(teamVocabularyTerms.id, termId),
        eq(teamVocabularyTerms.teamId, workspace.teamId),
      ),
    )
    .returning({ id: teamVocabularyTerms.id });

  if (!removed[0]) {
    return Response.json({ error: "Term not found" }, { status: 404 });
  }

  return new Response(null, { status: 204 });
}
