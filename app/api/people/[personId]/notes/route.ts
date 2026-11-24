import { getCurrentUser } from "@/lib/auth";
import { createPersonNote, listPersonNotes, personNoteInput } from "@/lib/person-notes";
import { getPersonIdentity, getPersonWorkspace } from "@/lib/people";

export const runtime = "nodejs";

type Context = { params: Promise<{ personId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { personId } = await params;
  const workspace = await getPersonWorkspace(user, personId);
  if ((await getPersonIdentity(workspace, personId)).kind !== "found") {
    return Response.json({ error: "Person not found" }, { status: 404 });
  }
  return Response.json({ notes: await listPersonNotes(workspace, personId) });
}

export async function POST(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const input = personNoteInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Enter a note up to 4,000 characters." }, { status: 400 });
  const { personId } = await params;
  const workspace = await getPersonWorkspace(user, personId);
  if ((await getPersonIdentity(workspace, personId)).kind !== "found") {
    return Response.json({ error: "Person not found" }, { status: 404 });
  }
  const note = await createPersonNote(workspace, personId, input.data.body);
  return note ? Response.json({ note }, { status: 201 }) : Response.json({ error: "Person not found" }, { status: 404 });
}
