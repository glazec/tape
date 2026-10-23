import { z } from "zod";

import { meetingNoteSchema } from "@/lib/meeting-note-document";
import { getCurrentUser } from "@/lib/auth";
import {
  canReadMeetingNotes,
  getMeetingNote,
  saveMeetingNote,
} from "@/lib/meeting-notes";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

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
  const parsed = meetingNoteSchema.safeParse(
    await request.json().catch(() => null),
  );
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
