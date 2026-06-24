import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  meetingAccess,
  meetings,
  teamMemberships,
  users,
} from "@/db/schema";
import { normalizeEmail } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.string().uuid();
const shareRequestSchema = z
  .object({
    email: z.string().trim().email().max(320).transform(normalizeEmail),
  })
  .strict();

export async function POST(
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
  const result = shareRequestSchema.safeParse(body);

  if (!result.success) {
    return Response.json({ error: "Invalid coworker email" }, { status: 400 });
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

  const targetRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .innerJoin(
      teamMemberships,
      and(
        eq(teamMemberships.userId, users.id),
        eq(teamMemberships.teamId, workspace.teamId),
      ),
    )
    .where(eq(users.email, result.data.email))
    .limit(1);
  const targetUser = targetRows[0];

  if (!targetUser) {
    return Response.json(
      { error: "Coworker must be a member of this team first." },
      { status: 404 },
    );
  }

  if (targetUser.id !== workspace.userId) {
    await db
      .insert(meetingAccess)
      .values({
        meetingId: parsedMeetingId.data,
        role: "shared",
        userId: targetUser.id,
      })
      .onConflictDoNothing({
        target: [meetingAccess.meetingId, meetingAccess.userId],
      });
  }

  return Response.json({
    shared: true,
    user: {
      email: targetUser.email,
      name: targetUser.name,
    },
  });
}
