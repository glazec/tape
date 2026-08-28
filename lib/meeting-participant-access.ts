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
