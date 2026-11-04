import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { translationLanguageSchema } from "@/lib/meeting-translation-language";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const language = translationLanguageSchema.safeParse(form?.get("defaultLanguage"));
  if (!language.success) return Response.json({ error: "Select a supported language" }, { status: 400 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  await db.update(users).set({ defaultLanguage: language.data, updatedAt: new Date() })
    .where(eq(users.id, workspace.userId));
  return Response.json({ saved: true });
}
