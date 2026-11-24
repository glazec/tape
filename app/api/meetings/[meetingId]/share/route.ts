import { and, between, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { calendarEvents, meetings, users } from "@/db/schema";
import { normalizeEmail } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import {
  createMeetingSharePolicy,
  listActiveMeetingShares,
  meetingSharePolicyAppliesToMeeting,
  revokeMeetingRecipientAccess,
  revokeMeetingSharePolicy,
} from "@/lib/meeting-share-service";
import { listWorkspaceShareRecipients } from "@/lib/meeting-queries";
import {
  getCalendarSeriesKey,
  getMeetingShareMatchKeys,
  hasReliableMeetingShareMatchKeys,
  meetingsShareReliableMatch,
} from "@/lib/meeting-sharing";
import { getTeamConfiguration } from "@/lib/team-configuration";
import { getMeetingManagerCondition } from "@/lib/meeting-write-policy";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();
const shareIdSchema = z.uuid();
const recipientEmailSchema = z
  .string()
  .trim()
  .pipe(z.email().max(320))
  .transform(normalizeEmail);
const shareRequestSchema = z
  .object({
    audience: z.enum(["organization", "team_group"]).optional(),
    email: recipientEmailSchema.optional(),
    includeRelated: z.boolean().optional().default(false),
    preview: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (Boolean(value.email) === Boolean(value.audience)) {
      context.addIssue({
        code: "custom",
        message: "Choose one sharing recipient",
      });
    }
  });

type MeetingMatchCandidate = {
  attendeeEmails: unknown;
  connectionId: string | null;
  externalEventId: string | null;
  id: string;
  title: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const access = await getAccessibleMeeting(context);

  if (access instanceof Response) {
    return access;
  }

  return Response.json({
    shares: await listActiveMeetingShares(access.meeting.id),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const access = await getAccessibleMeeting(context);

  if (access instanceof Response) {
    return access;
  }

  const body = await request.json().catch(() => null);
  const result = shareRequestSchema.safeParse(body);

  if (!result.success) {
    return Response.json({ error: "Invalid sharing details" }, { status: 400 });
  }

  const shareRequest = result.data;

  if (shareRequest.audience) {
    return shareWithAudience(shareRequest.audience, access);
  }

  const recipientEmail = shareRequest.email;

  if (!recipientEmail) {
    return Response.json({ error: "Invalid sharing details" }, { status: 400 });
  }

  if (recipientEmail === normalizeEmail(access.user.email)) {
    return Response.json({ error: "You already have access" }, { status: 400 });
  }

  if (shareRequest.includeRelated && !access.meeting.canManage) {
    return Response.json(
      {
        error:
          "Only the meeting owner or a workspace administrator can share related meetings",
      },
      { status: 403 },
    );
  }

  const scope = shareRequest.includeRelated ? "related" : "single";
  const activeShares = await listActiveMeetingShares(access.meeting.id);
  const existingShare = activeShares.find(
    (share) => share.email === recipientEmail && share.scope === scope,
  );

  if (existingShare && !shareRequest.preview) {
    return Response.json({
      alreadyShared: true,
      email: recipientEmail,
      futureMeetings: scope === "related",
      meetingCount: 1,
      pending: existingShare.pending,
      shared: true,
    });
  }

  if (!shareRequest.includeRelated) {
    const shared = await createMeetingSharePolicy({
      createdByUserId: access.workspace.userId,
      matchKeys: [],
      meetingIds: [access.meeting.id],
      ownerUserId: access.meeting.ownerUserId,
      recipientEmail,
      scope: "single",
      seedMeetingId: access.meeting.id,
      teamId: access.meeting.teamId,
    });

    if (shared.shared === false) {
      return Response.json(
        { error: "The meeting owner removed this person’s access" },
        { status: 409 },
      );
    }

    return Response.json({
      email: recipientEmail,
      futureMeetings: false,
      meetingCount: 1,
      pending: shared.pending,
      shared: true,
    });
  }

  const matchKeys = getMeetingShareMatchKeys({
    connectionId: access.meeting.connectionId,
    externalEventId: access.meeting.externalEventId,
    attendeeEmails: access.meeting.attendeeEmails,
    title: access.meeting.title,
    workspaceDomain: access.workspace.domain,
  });

  if (!hasReliableMeetingShareMatchKeys(matchKeys)) {
    // A manual recording can sit beside the actual calendar occurrence. Let
    // the manager review that separate meeting before creating a series grant.
    const startedAt = access.meeting.startedAt;
    if (!access.meeting.externalEventId && startedAt && matchKeys.some(key => key.startsWith("title:"))) {
      const windowMs = 15 * 60_000;
      const calendarMatches = await db.select({ id: meetings.id })
        .from(meetings)
        .innerJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
        .where(and(
          eq(meetings.teamId, access.meeting.teamId),
          getMeetingManagerCondition(access.workspace),
          eq(meetings.title, access.meeting.title),
          ne(meetings.status, "cancelled"),
          between(meetings.startedAt, new Date(startedAt.getTime() - windowMs), new Date(startedAt.getTime() + windowMs)),
          sql`${calendarEvents.externalEventId} ~ '^[a-zA-Z0-9]+_[0-9]{8}(T[0-9]{6}Z)?$'`,
        )).limit(2);
      if (calendarMatches.length === 1) {
        return Response.json({
          error: "This recording is separate from the calendar series. Open the calendar meeting to review sharing for the series.",
          calendarMeetingId: calendarMatches[0].id,
        }, { status: 409 });
      }
    }
    return Response.json(
      { error: "This meeting has no reliable related meeting pattern" },
      { status: 400 },
    );
  }

  // Team calendar sync can choose a different attendee’s calendar on each
  // occurrence. Include copies confirmed to be this exact team event.
  if (access.meeting.externalEventId && access.meeting.teamMeetingKey && matchKeys.some(key => key.startsWith("series:"))) {
    const copies = await db.select({ connectionId: calendarEvents.connectionId })
      .from(calendarEvents).where(and(
        eq(calendarEvents.teamId, access.meeting.teamId),
        eq(calendarEvents.teamMeetingKey, access.meeting.teamMeetingKey),
        eq(calendarEvents.externalEventId, access.meeting.externalEventId),
      ));
    for (const copy of copies) {
      const key = getCalendarSeriesKey(copy.connectionId, access.meeting.externalEventId);
      if (key && !matchKeys.includes(key)) matchKeys.push(key);
    }
  }

  const candidates = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      connectionId: calendarEvents.connectionId,
      externalEventId: calendarEvents.externalEventId,
      id: meetings.id,
      title: meetings.title,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(
      and(
        eq(meetings.teamId, access.meeting.teamId),
        eq(meetings.ownerUserId, access.meeting.ownerUserId),
        ne(meetings.status, "cancelled"),
      ),
    );
  const relatedMeetings = candidates.filter((candidate) =>
    meetingsShareReliableMatch(
      matchKeys,
      getCandidateMatchKeys(candidate, access.workspace.domain),
    ),
  );

  if (!relatedMeetings.some(({ id }) => id === access.meeting.id)) {
    relatedMeetings.unshift(access.meeting);
  }

  if (shareRequest.preview) {
    return Response.json({
      email: recipientEmail,
      futureMeetings: true,
      meetingCount: relatedMeetings.length,
      meetings: relatedMeetings.map(({ id, title }) => ({ id, title })),
      preview: true,
      shared: false,
    });
  }

  const shared = await createMeetingSharePolicy({
    createdByUserId: access.workspace.userId,
    matchKeys,
    meetingIds: relatedMeetings.map(({ id }) => id),
    ownerUserId: access.meeting.ownerUserId,
    recipientEmail,
    scope: "related",
    seedMeetingId: access.meeting.id,
    teamId: access.meeting.teamId,
  });

  if (shared.shared === false) {
    return Response.json(
      { error: "The meeting owner removed this person’s access" },
      { status: 409 },
    );
  }

  return Response.json({
    email: recipientEmail,
    futureMeetings: true,
    meetingCount: relatedMeetings.length,
    pending: shared.pending,
    shared: true,
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const access = await getAccessibleMeeting(context);

  if (access instanceof Response) {
    return access;
  }

  if (!access.meeting.canManage) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const recipientEmail = searchParams.get("email");

  if (recipientEmail !== null) {
    const parsedEmail = recipientEmailSchema.safeParse(recipientEmail);

    if (!parsedEmail.success) {
      return Response.json({ error: "Invalid recipient" }, { status: 400 });
    }

    if (
      parsedEmail.data === normalizeEmail(access.user.email) ||
      parsedEmail.data === access.meeting.ownerEmail
    ) {
      return Response.json(
        { error: "Meeting owner access cannot be removed" },
        { status: 400 },
      );
    }

    await revokeMeetingRecipientAccess({
      createdByUserId: access.workspace.userId,
      meetingId: access.meeting.id,
      recipientEmail: parsedEmail.data,
    });

    return Response.json({ email: parsedEmail.data, revoked: true });
  }

  const shareId = searchParams.get("shareId");
  const parsedShareId = shareIdSchema.safeParse(shareId);

  if (
    !parsedShareId.success ||
    !(await meetingSharePolicyAppliesToMeeting(
      parsedShareId.data,
      access.meeting.id,
    ))
  ) {
    return Response.json({ error: "Share not found" }, { status: 404 });
  }

  await revokeMeetingSharePolicy(parsedShareId.data);

  return Response.json({ revoked: true });
}

function getCandidateMatchKeys(
  candidate: MeetingMatchCandidate,
  workspaceDomain: string,
) {
  return getMeetingShareMatchKeys({
    connectionId: candidate.connectionId,
    externalEventId: candidate.externalEventId,
    attendeeEmails: candidate.attendeeEmails,
    title: candidate.title,
    workspaceDomain,
  });
}

async function getAccessibleMeeting(context: {
  params: Promise<{ meetingId: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId } = await context.params;
  const parsedMeetingId = meetingIdSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const [meeting] = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      connectionId: calendarEvents.connectionId,
      externalEventId: calendarEvents.externalEventId,
      canManage: getMeetingManagerCondition(workspace),
      startedAt: meetings.startedAt,
      teamMeetingKey: calendarEvents.teamMeetingKey,
      id: meetings.id,
      ownerEmail: sql<string>`(
        select lower(${users.email})
        from ${users}
        where ${users.id} = ${meetings.ownerUserId}
      )`,
      ownerUserId: meetings.ownerUserId,
      teamId: meetings.teamId,
      title: meetings.title,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        getReadableMeetingsCondition(workspace),
      ),
    )
    .limit(1);

  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  return { meeting, user, workspace };
}

type AccessibleMeetingAccess = Exclude<
  Awaited<ReturnType<typeof getAccessibleMeeting>>,
  Response
>;

async function shareWithAudience(
  audience: "organization" | "team_group",
  access: AccessibleMeetingAccess,
) {
  const currentUserEmail = normalizeEmail(access.user.email);
  const teamConfiguration =
    audience === "team_group"
      ? await getTeamConfiguration(access.workspace.teamId)
      : null;

  if (audience === "team_group" && !teamConfiguration?.shareAudience) {
    return Response.json(
      { error: "No team sharing group is configured" },
      { status: 400 },
    );
  }

  const audienceMembers = audience === "organization"
    ? await listWorkspaceShareRecipients(access.workspace)
    : (teamConfiguration?.shareAudience?.emails.map((email) => ({
        email,
        name: null,
      })) ?? []);
  const recipients = audienceMembers.filter(
    ({ email }) =>
      email !== currentUserEmail && email !== access.meeting.ownerEmail,
  );

  const results = await Promise.all(
    recipients.map(({ email }) =>
      createMeetingSharePolicy({
        createdByUserId: access.workspace.userId,
        matchKeys: [],
        meetingIds: [access.meeting.id],
        ownerUserId: access.meeting.ownerUserId,
        recipientEmail: email,
        scope: "single",
        seedMeetingId: access.meeting.id,
        teamId: access.meeting.teamId,
      }),
    ),
  );

  return Response.json({
    audience,
    recipientCount: results.filter((result) => result.shared !== false).length,
    shared: true,
  });
}
