import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { teamSpeakerAliases, meetingParticipantTimeline } from "@/db/schema";
import {
  buildTeamSpeakerAliasRows,
  resolveParticipantSpeakerAliases,
  type SpeakerAlias,
} from "@/lib/speaker-alias-normalization";

export async function listTeamSpeakerAliases(
  teamId: string,
): Promise<SpeakerAlias[]> {
  return db
    .select({
      alias: teamSpeakerAliases.alias,
      canonicalName: teamSpeakerAliases.canonicalName,
    })
    .from(teamSpeakerAliases)
    .where(and(eq(teamSpeakerAliases.teamId, teamId), sql`${teamSpeakerAliases.alias} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`))
    .orderBy(asc(teamSpeakerAliases.updatedAt), asc(teamSpeakerAliases.id));
}

export async function upsertTeamSpeakerAliases(input: {
  aliases: Array<string | null>;
  canonicalName: string;
  teamId: string;
}) {
  const rows = buildTeamSpeakerAliasRows(input);

  if (rows.length === 0) {
    return;
  }

  await db
    .insert(teamSpeakerAliases)
    .values(rows)
    .onConflictDoUpdate({
      target: [teamSpeakerAliases.teamId, teamSpeakerAliases.aliasKey],
      set: {
        alias: sql`excluded.alias`,
        canonicalName: sql`excluded.canonical_name`,
        updatedAt: new Date(),
      },
    });
}

export async function listMeetingSpeakerAliases(teamId: string, meetingId: string): Promise<SpeakerAlias[]> {
  const [aliases, people] = await Promise.all([
    listTeamSpeakerAliases(teamId),
    db.select({ name: meetingParticipantTimeline.name, email: meetingParticipantTimeline.email })
      .from(meetingParticipantTimeline).where(eq(meetingParticipantTimeline.meetingId, meetingId))
      .orderBy(asc(meetingParticipantTimeline.startMs)),
  ]);
  return resolveParticipantSpeakerAliases(aliases, people);
}
