import { z } from "zod";
import { db } from "@/db/client";
import { meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import { openParticipantPerson, openSpeakerPerson, personDatabaseError } from "@/lib/people";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

// Opens the workspace person behind a meeting speaker or participant, creating
// and linking one on first open. Who said what is unchanged.
const openPersonSchema = z.union([
  z.strictObject({ meetingSpeakerId: z.uuid() }),
  z.strictObject({ email: z.email().max(254), name: z.string().trim().max(80).nullable().optional() }),
]);

export async function POST(request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = openPersonSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Choose a speaker or participant" }, { status: 400 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) return Response.json({ error: "Meeting not found" }, { status: 404 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const [meeting] = await db.select({ id: meetings.id }).from(meetings).where(getManageableMeetingCondition(workspace, meetingId)).limit(1);
  if (!meeting) return Response.json({ error: "Meeting not found" }, { status: 404 });
  try {
    const personId = "meetingSpeakerId" in body.data
      ? await openSpeakerPerson(meetingId, body.data.meetingSpeakerId)
      : await openParticipantPerson(meetingId, body.data.email, body.data.name ?? null);
    return Response.json({ personId });
  } catch (error) {
    const response = personDatabaseError(error);
    if (response) return response;
    throw error;
  }
}
