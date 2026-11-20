import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  calendarEvents,
  meetings,
  teams,
  teamVocabularyTerms,
  users,
} from "@/db/schema";
import {
  getEmailDomain,
  getExternalOrganizationDomain,
} from "@/lib/email-domains";
import { buildTranscriptionKeyterms } from "@/lib/meeting-intelligence";
import { listMeetingParticipantTimeline } from "@/lib/meeting-participant-timeline";
import {
  formatOrganizationName,
  getWorkspaceDisplayName,
} from "@/lib/team-name";
import { getTwentyCrmCompanyDomains } from "@/lib/vendors/twenty";

export async function getMeetingVocabularyKeyterms(meetingId: string) {
  const [meeting] = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      botName: meetings.botDisplayName,
      ownerEmail: users.email,
      teamId: meetings.teamId,
      teamName: teams.name,
      title: meetings.title,
    })
    .from(meetings)
    .innerJoin(teams, eq(teams.id, meetings.teamId))
    .innerJoin(users, eq(users.id, meetings.ownerUserId))
    .leftJoin(
      calendarEvents,
      and(
        eq(calendarEvents.id, meetings.calendarEventId),
        eq(calendarEvents.teamId, meetings.teamId),
      ),
    )
    .where(eq(meetings.id, meetingId))
    .limit(1);

  if (!meeting) {
    return [];
  }

  const [vocabulary, participants, companies] = await Promise.all([
    listTeamVocabularyTerms(meeting.teamId),
    listMeetingParticipantTimeline(meetingId),
    getTwentyCrmCompanyDomains(meeting.teamId),
  ]);
  const botName = normalizeKeyterm(meeting.botName ?? "");
  const participantNames = participants
    .map(({ name }) => name)
    .filter((name): name is string =>
      Boolean(name && !name.includes("@") && normalizeKeyterm(name) !== botName),
    );
  const workspaceDomain = getEmailDomain(meeting.ownerEmail);
  const attendeeEmails = [
    ...(meeting.attendeeEmails ?? []),
    ...participants.map(({ email }) => email ?? ""),
  ];
  const domains = new Set(
    attendeeEmails
      .map((email) => getExternalOrganizationDomain(email, workspaceDomain))
      .filter((domain): domain is string => domain !== null),
  );

  const title = ` ${normalizeTitle(meeting.title)} `;
  const companiesInTitle = companies.filter(({ name }) => {
    const normalizedName = normalizeTitle(name);
    return normalizedName.length >= 2 && title.includes(` ${normalizedName} `);
  });
  const attendeeOrganizations = [...domains].flatMap((domain) => {
    const matches = companies.filter((company) =>
      domain === company.domain || domain.endsWith(`.${company.domain}`),
    );
    return matches.length > 0
      ? matches.map(({ name }) => name)
      : [formatOrganizationName(domain)];
  });
  const disabled = new Set(
    vocabulary.filter(({ enabled }) => !enabled)
      .map(({ term }) => normalizeKeyterm(term)),
  );
  const defaultTeamName = `${getWorkspaceDisplayName(workspaceDomain ?? "")} workspace`;
  const contextualTerms = [
    ...participantNames,
    ...attendeeOrganizations,
    ...companiesInTitle.map(({ name }) => name),
    ...(meeting.teamName === defaultTeamName ? [] : [meeting.teamName]),
  ].filter((term) => !disabled.has(normalizeKeyterm(term)));

  return buildTranscriptionKeyterms(
    vocabulary.filter(({ enabled }) => enabled).map(({ term }) => term),
    contextualTerms,
  );
}

function normalizeKeyterm(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeTitle(value: string) {
  return normalizeKeyterm(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
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
