import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { personDatabaseError, setTodoStatus } from "@/lib/people";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const todoStatusSchema = z.strictObject({
  todoKey: z.string().regex(/^[0-9a-f]{32}$/),
  status: z.enum(["todo", "in_progress", "done"]),
});

// Team-wide progress on a followup to do. Colleagues of the meeting's
// workspace can change it, even without opening the meeting itself.
export async function PATCH(request: Request, context: { params: Promise<{ meetingId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = todoStatusSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Choose a valid status" }, { status: 400 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) return Response.json({ error: "Meeting not found" }, { status: 404 });
  await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  try {
    return Response.json(await setTodoStatus(meetingId, body.data.todoKey, body.data.status));
  } catch (error) {
    const response = personDatabaseError(error);
    if (response) return response;
    throw error;
  }
}
