import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { calendarEvents, meetings } from "@/db/schema";
import { normalizeEmail } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import {
  createMeetingSharePolicy,
  listActiveMeetingShares,
  meetingSharePolicyAppliesToMeeting,
  revokeMeetingSharePolicy,
} from "@/lib/meeting-share-service";
import {
  getMeetingShareMatchKeys,
  meetingsShareAnyMatchKey,
} from "@/lib/meeting-sharing";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();
const shareIdSchema = z.uuid();
const shareRequestSchema = z.strictObject({
  email: z
    .string()
    .trim()
    .pipe(z.email().max(320))
    .transform(normalizeEmail),
  includeRelated: z.boolean().optional().default(false),
  preview: z.boolean().optional().default(false),
});

type MeetingMatchCandidate = {
  attendeeEmails: unknown;
  id: string;
  title: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const access = await getManageableMeeting(context);

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
  const access = await getManageableMeeting(context);

  if (access instanceof Response) {
    return access;
  }

  const body = await request.json().catch(() => null);
  const result = shareRequestSchema.safeParse(body);

  if (!result.success) {
    return Response.json({ error: "Invalid sharing details" }, { status: 400 });
  }

  if (result.data.email === normalizeEmail(access.user.email)) {
    return Response.json({ error: "You already have access" }, { status: 400 });
  }

  const scope = result.data.includeRelated ? "related" : "single";
  const activeShares = await listActiveMeetingShares(access.meeting.id);
  const existingShare = activeShares.find(
    (share) => share.email === result.data.email && share.scope === scope,
  );

  if (existingShare && !result.data.preview) {
    return Response.json({
      alreadyShared: true,
      email: result.data.email,
      futureMeetings: scope === "related",
      meetingCount: 1,
      pending: existingShare.pending,
      shared: true,
    });
  }

  if (!result.data.includeRelated) {
    const shared = await createMeetingSharePolicy({
      createdByUserId: access.workspace.userId,
      matchKeys: [],
      meetingIds: [access.meeting.id],
      ownerUserId: access.meeting.ownerUserId,
      recipientEmail: result.data.email,
      scope: "single",
      seedMeetingId: access.meeting.id,
      teamId: access.workspace.teamId,
    });

    return Response.json({
      email: result.data.email,
      futureMeetings: false,
      meetingCount: 1,
      pending: shared.pending,
      shared: true,
    });
  }

  const matchKeys = getMeetingShareMatchKeys({
    attendeeEmails: access.meeting.attendeeEmails,
    title: access.meeting.title,
    workspaceDomain: access.workspace.domain,
  });

  if (matchKeys.length === 0) {
    return Response.json(
      { error: "This meeting has no reliable related meeting pattern" },
      { status: 400 },
    );
  }

  const candidates = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      id: meetings.id,
      title: meetings.title,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(
      and(
        eq(meetings.teamId, access.workspace.teamId),
        eq(meetings.ownerUserId, access.meeting.ownerUserId),
        ne(meetings.status, "cancelled"),
      ),
    );
  const relatedMeetings = candidates.filter((candidate) =>
    meetingsShareAnyMatchKey(
      matchKeys,
      getCandidateMatchKeys(candidate, access.workspace.domain),
    ),
  );

  if (!relatedMeetings.some(({ id }) => id === access.meeting.id)) {
    relatedMeetings.unshift(access.meeting);
  }

  if (result.data.preview) {
    return Response.json({
      email: result.data.email,
      futureMeetings: true,
      meetingCount: relatedMeetings.length,
      meetings: relatedMeetings.slice(0, 5).map(({ id, title }) => ({ id, title })),
      preview: true,
      shared: false,
    });
  }

  const shared = await createMeetingSharePolicy({
    createdByUserId: access.workspace.userId,
    matchKeys,
    meetingIds: relatedMeetings.map(({ id }) => id),
    ownerUserId: access.meeting.ownerUserId,
    recipientEmail: result.data.email,
    scope: "related",
    seedMeetingId: access.meeting.id,
    teamId: access.workspace.teamId,
  });

  return Response.json({
    email: result.data.email,
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
  const access = await getManageableMeeting(context);

  if (access instanceof Response) {
    return access;
  }

  const shareId = new URL(request.url).searchParams.get("shareId");
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
    attendeeEmails: candidate.attendeeEmails,
    title: candidate.title,
    workspaceDomain,
  });
}

async function getManageableMeeting(context: {
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

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const [meeting] = await db
    .select({
      attendeeEmails: calendarEvents.attendeeEmails,
      id: meetings.id,
      ownerUserId: meetings.ownerUserId,
      title: meetings.title,
    })
    .from(meetings)
    .leftJoin(calendarEvents, eq(calendarEvents.id, meetings.calendarEventId))
    .where(getManageableMeetingCondition(workspace, parsedMeetingId.data))
    .limit(1);

  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  return { meeting, user, workspace };
}
