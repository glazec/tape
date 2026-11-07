import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPersonWorkspace, listMergeCandidates, mergePeople, personDatabaseError, unmergePeople } from "@/lib/people";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ personId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { personId } = await context.params;
  if (!z.uuid().safeParse(personId).success) return Response.json({ error: "Person not found" }, { status: 404 });
  const workspace = await getPersonWorkspace(user, personId);
  return Response.json({ people: await listMergeCandidates(workspace, personId) });
}

const mergeSchema = z.strictObject({
  sourceIds: z.array(z.uuid()).min(1).max(20),
  keepName: z.string().trim().min(1).max(80).nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ personId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Choose people to merge" }, { status: 400 });
  const { personId } = await context.params;
  if (!z.uuid().safeParse(personId).success) return Response.json({ error: "Person not found" }, { status: 404 });
  await getPersonWorkspace(user, personId);
  try {
    await mergePeople(personId, [...new Set(body.data.sourceIds)], body.data.keepName ?? null);
    return Response.json({ personId });
  } catch (error) {
    const response = personDatabaseError(error);
    if (response) return response;
    throw error;
  }
}

// Undo the latest merge into this person.
export async function DELETE(_request: Request, context: { params: Promise<{ personId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { personId } = await context.params;
  if (!z.uuid().safeParse(personId).success) return Response.json({ error: "Person not found" }, { status: 404 });
  await getPersonWorkspace(user, personId);
  try {
    return Response.json(await unmergePeople(personId));
  } catch (error) {
    const response = personDatabaseError(error);
    if (response) return response;
    throw error;
  }
}
