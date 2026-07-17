import {
  and,
  eq,
  inArray,
  notInArray,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  allowedDomains,
  meetingAccessSources,
  meetingAttendees,
  teamMemberships,
  users,
} from "@/db/schema";
import { normalizeEmail, normalizeEmailDomain } from "@/lib/access";
import {
  grantMeetingAccessByEmail,
  reconcileEffectiveMeetingAccess,
} from "@/lib/meeting-access-grants";

const participantSourceId = "calendar";

export async function syncMeetingParticipantAccess(input: {
  attendeeEmails: string[];
  meetingId: string;
  ownerUserId: string;
  teamId: string;
}) {
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
      await db
        .insert(meetingAttendees)
        .values({
          email,
          isInternal: internalEmails.includes(email),
          meetingId: input.meetingId,
        })
        .onConflictDoUpdate({
          target: [meetingAttendees.meetingId, meetingAttendees.email],
          set: {
            isInternal: internalEmails.includes(email),
            updatedAt: new Date(),
          },
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
        ...(eligibleEmails.length > 0
          ? [notInArray(meetingAccessSources.recipientEmail, eligibleEmails)]
          : []),
      ),
    );

  for (const email of eligibleEmails) {
    await grantMeetingAccessByEmail({
      createdByUserId: input.ownerUserId,
      email,
      meetingId: input.meetingId,
      role: "attendee",
      source: "participant",
      sourceId: participantSourceId,
    });
  }

  await reconcileEffectiveMeetingAccess(input.meetingId, input.ownerUserId);

  return {
    attendeeCount: attendeeEmails.length,
    internalParticipantCount: eligibleEmails.length,
  };
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
