import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, teamVocabularyTerms } from "@/db/schema";
import { buildTeamVocabularyKeyterms } from "@/lib/meeting-intelligence";

export async function getTeamVocabularyKeyterms(teamId: string) {
  const rows = await db
    .select({ term: teamVocabularyTerms.term })
    .from(teamVocabularyTerms)
    .where(
      and(
        eq(teamVocabularyTerms.teamId, teamId),
        eq(teamVocabularyTerms.enabled, true),
      ),
    )
    .orderBy(asc(teamVocabularyTerms.term));

  return buildTeamVocabularyKeyterms(rows);
}

export async function getMeetingVocabularyKeyterms(meetingId: string) {
  const [meeting] = await db
    .select({ teamId: meetings.teamId })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);

  if (!meeting) {
    return [];
  }

  return getTeamVocabularyKeyterms(meeting.teamId);
}

export async function listTeamVocabularyTerms(teamId: string) {
  return db
    .select({
      id: teamVocabularyTerms.id,
      term: teamVocabularyTerms.term,
      hint: teamVocabularyTerms.hint,
      enabled: teamVocabularyTerms.enabled,
    })
    .from(teamVocabularyTerms)
    .where(eq(teamVocabularyTerms.teamId, teamId))
    .orderBy(asc(teamVocabularyTerms.term));
}
