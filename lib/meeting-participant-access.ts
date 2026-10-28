import {
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  allowedDomains,
  meetingAccessSources,
  meetingAttendees,
  meetingParticipantTimeline,
  meetings,
  teamMemberships,
  users,
} from "@/db/schema";
import { normalizeEmail, normalizeEmailDomain } from "@/lib/access";
import {
  grantMeetingAccessByEmail,
  reconcileEffectiveMeetingAccess,
} from "@/lib/meeting-access-grants";
import { listTeamSpeakerAliases } from "@/lib/speaker-aliases";
import { getSpeakerIdentityKey } from "@/lib/speaker-labels";

const participantSourceId = "calendar";
// Kept apart from calendar grants so a calendar resync never revokes them.
const recognizedParticipantSourceId = "recognized_speakers";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function syncMeetingParticipantAccess(input: {
  attendeeEmails: string[];
  meetingId: string;
  ownerUserId: string;
  teamId: string;
}) {
  const startedAt = Date.now();
  const domains = await db
    .select({ domain: allowedDomains.domain })
    .from(allowedDomains)
    .where(eq(allowedDomains.teamId, input.teamId));
  const { attendeeEmails, internalEmails } = classifyMeetingAttendeeEmails(
    input.attendeeEmails,
    domains.map(({ domain }) => domain),
  );

  if (attendeeEmails.length > 0) {
    await db
      .delete(meetingAttendees)
      .where(
        and(
          eq(meetingAttendees.meetingId, input.meetingId),
          notInArray(meetingAttendees.email, attendeeEmails),
        ),
      );

    for (const email of attendeeEmails) {
      const isInternal = internalEmails.includes(email);

      await db
        .insert(meetingAttendees)
        .values({
          email,
          isInternal,
          meetingId: input.meetingId,
        })
        .onConflictDoUpdate({
          target: [meetingAttendees.meetingId, meetingAttendees.email],
          set: {
            isInternal,
            updatedAt: new Date(),
          },
          setWhere: sql`${meetingAttendees.isInternal} is distinct from ${isInternal}`,
        });
    }
  } else {
    await db
      .delete(meetingAttendees)
      .where(eq(meetingAttendees.meetingId, input.meetingId));
  }

  const participantAccounts =
    internalEmails.length > 0
      ? await db
          .select({
            email: users.email,
            id: users.id,
            role: teamMemberships.role,
          })
          .from(users)
          .leftJoin(
            teamMemberships,
            and(
              eq(teamMemberships.userId, users.id),
              eq(teamMemberships.teamId, input.teamId),
            ),
          )
          .where(inArray(users.email, internalEmails))
      : [];
  const { eligibleEmails } =
    getAutomaticParticipantRecipients(internalEmails, participantAccounts);

  await db
    .update(meetingAccessSources)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(meetingAccessSources.meetingId, input.meetingId),
        eq(meetingAccessSources.source, "participant"),
        eq(meetingAccessSources.sourceId, participantSourceId),
        isNull(meetingAccessSources.revokedAt),
        ...(eligibleEmails.length > 0
          ? [notInArray(meetingAccessSources.recipientEmail, eligibleEmails)]
          : []),
      ),
    );

  const grantResults = [];

  for (const email of eligibleEmails) {
    grantResults.push(
      await grantMeetingAccessByEmail({
        createdByUserId: input.ownerUserId,
        email,
        meetingId: input.meetingId,
        role: "attendee",
        source: "participant",
        sourceId: participantSourceId,
      }),
    );
  }

  await reconcileEffectiveMeetingAccess(input.meetingId, input.ownerUserId);

  await emitParticipantAccessTelemetry({
    attributes: {
      attendee_count: attendeeEmails.length,
      eligible_participant_count: eligibleEmails.length,
      excluded_participant_count:
        internalEmails.length - eligibleEmails.length,
      external_attendee_count:
        attendeeEmails.length - internalEmails.length,
      account_recipient_count: grantResults.filter((result) => !result.pending)
        .length,
      pending_invite_count: grantResults.filter((result) => result.pending)
        .length,
      duration_ms: Date.now() - startedAt,
    },
    eventName: "meeting.participant_access.synced",
  });

  return {
    attendeeCount: attendeeEmails.length,
    internalParticipantCount: eligibleEmails.length,
  };
}

async function emitParticipantAccessTelemetry(input: {
  attributes: Record<string, unknown>;
  eventName: string;
}) {
  try {
    const { emitTelemetryLog } = await import("@/lib/telemetry/server");
    emitTelemetryLog(input);
  } catch {
    // Telemetry must not change the access reconciliation result.
  }
}

function getAutomaticParticipantRecipients(
  internalEmails: string[],
  participantAccounts: Array<{
    email: string;
    id: string;
    role: string | null;
  }>,
) {
  const accountByEmail = new Map(
    participantAccounts.map((account) => [account.email, account]),
  );
  const eligibleAccounts = participantAccounts.filter(
    ({ role }) => role !== null && role !== "external",
  );

  return {
    eligibleEmails: internalEmails.filter((email) => {
      const account = accountByEmail.get(email);

      return !account || (account.role !== null && account.role !== "external");
    }),
    eligibleUserIds: eligibleAccounts.map(({ id }) => id),
  };
}

export function classifyMeetingAttendeeEmails(
  attendeeEmails: string[],
  allowedDomains: string[],
) {
  const normalizedAttendeeEmails = Array.from(
    new Set(attendeeEmails.map(normalizeEmail).filter(Boolean)),
  );
  const allowedDomainSet = new Set(
    allowedDomains.map((domain) => domain.trim().toLowerCase()),
  );

  return {
    attendeeEmails: normalizedAttendeeEmails,
    internalEmails: normalizedAttendeeEmails.filter((email) =>
      allowedDomainSet.has(normalizeEmailDomain(email)),
    ),
  };
}

/**
 * Emails for the people who spoke in a meeting. A participant's own email
 * from the meeting platform wins; otherwise a display name counts only when
 * it matches exactly one workspace member or remembered speaker, so a common
 * first name never shares a meeting with the wrong person.
 */
export function resolveRecognizedParticipantEmails(input: {
  aliases: Array<{ alias: string; canonicalName: string }>;
  members: Array<{ email: string; name: string | null }>;
  people: Array<{ email: string | null; name: string | null }>;
}) {
  const emailsByName = new Map<string, Set<string>>();
  const remember = (name: string | null, email: string) => {
    const normalized = normalizeEmail(email);

    if (!name?.trim() || !EMAIL_PATTERN.test(normalized)) return;

    const key = getSpeakerIdentityKey(name);
    const emails = emailsByName.get(key) ?? new Set<string>();
    emails.add(normalized);
    emailsByName.set(key, emails);
  };

  for (const member of input.members) remember(member.name, member.email);
  for (const alias of input.aliases) remember(alias.canonicalName, alias.alias);

  const recognized = new Set<string>();

  for (const person of input.people) {
    const ownEmail = person.email ? normalizeEmail(person.email) : "";

    if (EMAIL_PATTERN.test(ownEmail)) {
      recognized.add(ownEmail);
      continue;
    }

    if (
      !person.name?.trim() ||
      /^(speaker\s*\d+|unknown speaker)$/i.test(person.name.trim())
    ) {
      continue;
    }

    const matches = emailsByName.get(getSpeakerIdentityKey(person.name));

    if (matches?.size === 1) {
      recognized.add([...matches][0]);
    }
  }

  return [...recognized];
}

/**
 * Shares a recorded meeting with the workspace members the bot heard speak,
 * so an instant meeting reaches its participants the way a calendar meeting
 * reaches its invitees. Grants are additive and follow the calendar rule:
 * only addresses on the team's allowed domains, never external members.
 */
export async function shareMeetingWithRecognizedParticipants(meetingId: string) {
  const [meeting] = await db
    .select({
      ownerEmail: users.email,
      ownerUserId: meetings.ownerUserId,
      teamId: meetings.teamId,
    })
    .from(meetings)
    .innerJoin(users, eq(meetings.ownerUserId, users.id))
    .where(eq(meetings.id, meetingId))
    .limit(1);

  if (!meeting) {
    return { status: "not_found" as const, sharedCount: 0 };
  }

  const [people, members, aliases, domains] = await Promise.all([
    db
      .select({
        email: meetingParticipantTimeline.email,
        name: meetingParticipantTimeline.name,
      })
      .from(meetingParticipantTimeline)
      .where(eq(meetingParticipantTimeline.meetingId, meetingId)),
    db
      .select({ email: users.email, name: users.name })
      .from(teamMemberships)
      .innerJoin(users, eq(teamMemberships.userId, users.id))
      .where(eq(teamMemberships.teamId, meeting.teamId)),
    listTeamSpeakerAliases(meeting.teamId),
    db
      .select({ domain: allowedDomains.domain })
      .from(allowedDomains)
      .where(eq(allowedDomains.teamId, meeting.teamId)),
  ]);

  const ownerEmail = normalizeEmail(meeting.ownerEmail);
  const { internalEmails } = classifyMeetingAttendeeEmails(
    resolveRecognizedParticipantEmails({ aliases, members, people }).filter(
      (email) => email !== ownerEmail,
    ),
    domains.map(({ domain }) => domain),
  );

  if (internalEmails.length === 0) {
    return { status: "none" as const, sharedCount: 0 };
  }

  const participantAccounts = await db
    .select({ email: users.email, id: users.id, role: teamMemberships.role })
    .from(users)
    .leftJoin(
      teamMemberships,
      and(
        eq(teamMemberships.userId, users.id),
        eq(teamMemberships.teamId, meeting.teamId),
      ),
    )
    .where(inArray(users.email, internalEmails));
  const { eligibleEmails } = getAutomaticParticipantRecipients(
    internalEmails,
    participantAccounts,
  );

  for (const email of eligibleEmails) {
    await grantMeetingAccessByEmail({
      createdByUserId: meeting.ownerUserId,
      email,
      meetingId,
      role: "attendee",
      source: "participant",
      sourceId: recognizedParticipantSourceId,
    });
  }

  if (eligibleEmails.length > 0) {
    await reconcileEffectiveMeetingAccess(meetingId, meeting.ownerUserId);
  }

  return { status: "shared" as const, sharedCount: eligibleEmails.length };
}
