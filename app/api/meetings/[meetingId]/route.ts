import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { upgradeFollowupHashesForRename } from "@/lib/meeting-followup-source";
import { deleteMeetingMediaObjects } from "@/lib/meeting-media-cleanup";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
import { revokeMeetingSharesSeededByMeeting } from "@/lib/meeting-share-service";
import {
  getManageableMeetingCondition,
  getOwnedMeetingCondition,
} from "@/lib/meeting-write-policy";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();
const renameMeetingSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId } = await context.params;
  const parsedMeetingId = meetingIdSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsedBody = renameMeetingSchema.safeParse(body);

  if (!parsedBody.success) {
    return Response.json({ error: "Invalid meeting title" }, { status: 400 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meetingRows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(getManageableMeetingCondition(workspace, parsedMeetingId.data))
    .limit(1);

  if (!meetingRows[0]) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  // Followups saved before hashes dropped the title are bound to the old one;
  // carry them over so renaming never forces a regeneration.
  const followupMeeting = await getComposedMeetingForFollowup(workspace, parsedMeetingId.data);
  const upgradedFollowup = followupMeeting ? upgradeFollowupHashesForRename(followupMeeting) : null;

  await db
    .update(meetings)
    .set({
      title: parsedBody.data.title,
      titleSource: "manual",
      updatedAt: new Date(),
    })
    .where(getManageableMeetingCondition(workspace, parsedMeetingId.data));

  if (followupMeeting && upgradedFollowup) {
    await db
      .update(meetings)
      .set({ aiFollowup: upgradedFollowup })
      .where(
        and(
          getManageableMeetingCondition(workspace, parsedMeetingId.data),
          eq(meetings.aiFollowup, followupMeeting.aiFollowup),
        ),
      );
  }

  await reconcileMeetingSharingForMeeting(parsedMeetingId.data);

  return Response.json({
    meetingId: parsedMeetingId.data,
    title: parsedBody.data.title,
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
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
  const meetingRows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(getOwnedMeetingCondition(workspace, parsedMeetingId.data))
    .limit(1);

  if (!meetingRows[0]) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  try {
    await deleteMeetingMediaObjects(parsedMeetingId.data);
  } catch {
    return Response.json(
      { error: "Meeting media could not be deleted" },
      { status: 503 },
    );
  }

  await revokeMeetingSharesSeededByMeeting(parsedMeetingId.data);

  await db
    .delete(meetings)
    .where(getOwnedMeetingCondition(workspace, parsedMeetingId.data));

  return Response.json({ deleted: true });
}
