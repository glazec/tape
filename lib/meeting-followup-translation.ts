import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { acquireFollowupLease, releaseFollowupLease } from "@/lib/meeting-followup-lease";
import { getCurrentMeetingFollowup, getFollowupSourceHash, storedFollowupSchema } from "@/lib/meeting-followup-source";
import { meetingFollowupSchema, type MeetingFollowup } from "@/lib/meeting-followup";
import type { TranslationLanguage } from "@/lib/meeting-translation-language";
import { assertWorkspaceHasProviderCredit } from "@/lib/provider-credit";
import { translateTranscriptSegments } from "@/lib/vendors/openrouter";
import type { WorkspaceContext } from "@/lib/workspace";

// Translate only prose. Identity, ordering, item counts, status, evidence and
// exact source quotes are copied directly from the shared result.
export async function translateFollowupCopy(result: MeetingFollowup, language: TranslationLanguage, meetingId: string) {
  const copy = structuredClone(result);
  const fields: Array<{ id: string; text: string; apply: (text: string) => void }> = [];
  const add = (text: string, apply: (text: string) => void) => fields.push({ id: String(fields.length), text, apply });
  for (const item of [...copy.todos, ...copy.dynamics]) {
    add(item.text.slice(item.person.length).trim(), text => { item.text = `${item.person} ${text}`; });
    if ("timing" in item && typeof item.timing === "string") add(item.timing, text => { item.timing = text; });
  }
  for (const item of copy.research) {
    for (const key of ["question", "context", "evidenceToCollect"] as const) add(item[key], text => { item[key] = text; });
  }
  for (const item of copy.connections ?? []) add(item.context, text => { item.context = text; });
  const translated = await translateTranscriptSegments(fields.map(({ id, text }) => ({ id, text })), { targetLanguage: language, meetingId });
  const byId = new Map(translated.map(item => [item.id, item.text]));
  if (byId.size !== fields.length || fields.some(field => !byId.get(field.id)?.trim())) throw new Error("Incomplete followup translation");
  for (const field of fields) field.apply(byId.get(field.id)!);
  return meetingFollowupSchema.parse(copy);
}

export async function getOrTranslateFollowupCopy(workspace: WorkspaceContext, meetingId: string, language: TranslationLanguage, expectedSourceHash: string) {
  const load = async () => {
    const meeting = await getComposedMeetingForFollowup(workspace, meetingId);
    if (!meeting || getFollowupSourceHash(meeting) !== expectedSourceHash) return null;
    const result = getCurrentMeetingFollowup(meeting);
    const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
    return result && saved.success ? { meeting, result, saved: saved.data } : null;
  };
  const initial = await load();
  if (!initial) return null;
  if (language === "en") return initial.result;
  if (initial.saved.translations?.[language]) return initial.saved.translations[language]!;
  const token = await acquireFollowupLease(meetingId);
  if (!token) return "in_progress" as const;
  try {
    const current = await load();
    if (!current) return null;
    if (current.saved.translations?.[language]) return current.saved.translations[language]!;
    await assertWorkspaceHasProviderCredit(workspace);
    const translated = await translateFollowupCopy(current.result, language, meetingId);
    if (!await load()) return null; // Access and composition can change during translation.
    const [saved] = await db.update(meetings).set({ aiFollowup: {
      ...current.saved, translations: { ...current.saved.translations, [language]: translated },
    } }).where(and(eq(meetings.id, meetingId), eq(meetings.followupLeaseToken, token),
      eq(meetings.updatedAt, new Date(current.meeting.updatedAt)),
      eq(meetings.aiFollowup, current.meeting.aiFollowup),
    )).returning({ id: meetings.id });
    return saved ? translated : null;
  } finally {
    await releaseFollowupLease(meetingId, token);
  }
}
