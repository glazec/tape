import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
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

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const meetingRows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    )
    .limit(1);

  if (!meetingRows[0]) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  await db
    .update(meetings)
    .set({
      title: parsedBody.data.title,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    );

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

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const meetingRows = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    )
    .limit(1);

  if (!meetingRows[0]) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  await db
    .delete(meetings)
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    );

  return Response.json({ deleted: true });
}
