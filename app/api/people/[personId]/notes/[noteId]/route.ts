import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { deletePersonNote, personNoteInput, updatePersonNote } from "@/lib/person-notes";
import { getPersonIdentity, getPersonWorkspace } from "@/lib/people";

export const runtime = "nodejs";

type Context = { params: Promise<{ personId: string; noteId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { personId, noteId } = await params;
  if (!z.uuid().safeParse(noteId).success) return Response.json({ error: "Note not found" }, { status: 404 });
  const input = personNoteInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Enter a note up to 4,000 characters." }, { status: 400 });
  const workspace = await getPersonWorkspace(user, personId);
  if ((await getPersonIdentity(workspace, personId)).kind !== "found") {
    return Response.json({ error: "Person not found" }, { status: 404 });
  }
  const note = await updatePersonNote(workspace, personId, noteId, input.data.body);
  return note ? Response.json({ note }) : Response.json({ error: "Note not found" }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { personId, noteId } = await params;
  if (!z.uuid().safeParse(noteId).success) return Response.json({ error: "Note not found" }, { status: 404 });
  const workspace = await getPersonWorkspace(user, personId);
  if ((await getPersonIdentity(workspace, personId)).kind !== "found") {
    return Response.json({ error: "Person not found" }, { status: 404 });
  }
  return await deletePersonNote(workspace, personId, noteId)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "Note not found" }, { status: 404 });
}
