import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { connectionChangesSchema } from "@/lib/meeting-connections";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { getConnectionsRevision, getCurrentMeetingConnectionIds, getCurrentMeetingConnectionEntries, getCurrentMeetingConnections, storedFollowupSchema } from "@/lib/meeting-followup-source";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";
const requestSchema = z.strictObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  index: z.number().int().min(0).max(159),
  changes: connectionChangesSchema,
});

export async function PATCH(request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) return Response.json({ error: "Meeting not found" }, { status: 404 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meeting = await getComposedMeetingForFollowup(workspace, meetingId);
  if (!meeting?.canManage) return Response.json({ error: "Meeting not found" }, { status: 404 });
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid connection changes" }, { status: 400 });
  const { revision, index, changes } = input.data;
  const saved = storedFollowupSchema.safeParse(meeting.aiFollowup);
  const entry = getCurrentMeetingConnectionEntries(meeting)[index];
  if (!saved.success || !entry || getConnectionsRevision(meeting) !== revision) {
    return Response.json({ error: "Connections changed. Load the latest version to review before saving." }, { status: 409 });
  }
  if (!meeting.segments.some(segment => segment.id === changes.speakerSegmentId)) {
    return Response.json({ error: "Choose a speaker from this meeting." }, { status: 400 });
  }
  if (Object.values(saved.data.translations ?? {}).some(copy => copy?.connections?.[index]?.context === changes.context)) changes.context = entry.connection.context;
  const edits = (saved.data.connectionEdits ?? []).filter(edit => JSON.stringify(edit.original) !== JSON.stringify(entry.original));
  if (edits.length >= 80) return Response.json({ error: "This meeting has reached the connection edit limit." }, { status: 422 });
  const aiFollowup = { ...saved.data, translations: undefined, connectionEdits: [...edits, { original: entry.original, changes }] };
  try {
    const rows = await db.update(meetings).set({ aiFollowup }).where(and(
      getManageableMeetingCondition(workspace, meetingId),
      eq(meetings.status, "ready"),
      eq(meetings.updatedAt, new Date(meeting.updatedAt)),
      eq(meetings.aiFollowup, meeting.aiFollowup),
    )).returning({ id: meetings.id });
    if (!rows.length) return Response.json({ error: "The meeting changed. Load the latest version to review before saving." }, { status: 409 });
    const updated = { ...meeting, aiFollowup };
    return Response.json({ connections: getCurrentMeetingConnections(updated), revision: getConnectionsRevision(updated), connectionIds: getCurrentMeetingConnectionIds(updated) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Connection could not be saved. Try again." }, { status: 500 });
  }
}


export async function GET(_request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) return Response.json({ error: "Meeting not found" }, { status: 404 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meeting = await getComposedMeetingForFollowup(workspace, meetingId);
  if (!meeting?.canManage) return Response.json({ error: "Meeting not found" }, { status: 404 });
  return Response.json({ connections: getCurrentMeetingConnections(meeting), connectionIds: getCurrentMeetingConnectionIds(meeting), revision: getConnectionsRevision(meeting) }, { headers: { "Cache-Control": "private, no-store" } });
}
