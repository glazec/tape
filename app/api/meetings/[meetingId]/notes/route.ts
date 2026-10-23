import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  canReadMeetingNotes,
  getMeetingNote,
  saveMeetingNote,
} from "@/lib/meeting-notes";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const noteSchema = z.strictObject({
  content: z.string().max(20_000),
  version: z.number().int().min(0).max(2_147_483_646),
});
type Context = { params: Promise<{ meetingId: string }> };

async function authorize(context: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  if (!(await canReadMeetingNotes(workspace, meetingId))) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  return { workspace, meetingId };
}

export async function GET(_request: Request, context: Context) {
  const access = await authorize(context);
  if (access instanceof Response) return access;
  return Response.json(
    await getMeetingNote(access.workspace, access.meetingId),
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

export async function PUT(request: Request, context: Context) {
  const access = await authorize(context);
  if (access instanceof Response) return access;
  const parsed = noteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid notes" }, { status: 400 });
  }
  const note = await saveMeetingNote(
    access.workspace,
    access.meetingId,
    parsed.data,
  );
  if (!note) {
    return Response.json(
      { error: "Notes changed in another tab" },
      { status: 409 },
    );
  }
  return Response.json(note);
}
