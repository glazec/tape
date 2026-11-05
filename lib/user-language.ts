import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { normalizeTranslationLanguage } from "@/lib/meeting-translation-language";

export async function getUserLanguage(userId: string, fallback?: string) {
  const [user] = await db.select({ language: users.defaultLanguage }).from(users)
    .where(eq(users.id, userId)).limit(1);
  return normalizeTranslationLanguage(user?.language ?? fallback);
}
