import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import {
  listMergeCandidates,
  mergeMeetings,
  unmergeMeeting,
  MeetingCompositionError,
} from "@/lib/meeting-composition";
export const runtime = "nodejs";
type Context = { params: Promise<{ meetingId: string }> };
const bodySchema = z.strictObject({ sourceMeetingId: z.uuid() });
async function handle(
  request: Request,
  context: Context,
  operation: "GET" | "POST" | "DELETE",
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success)
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  const workspace = await getOrCreateWorkspaceForSessionUser(user, {
    meetingId,
  });
  try {
    if (operation === "GET")
      return Response.json(
        await listMergeCandidates(
          workspace,
          meetingId,
          (new URL(request.url).searchParams.get("query") ?? "").slice(0, 200),
        ),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success)
      return Response.json({ error: "Choose a meeting" }, { status: 400 });
    await (operation === "POST" ? mergeMeetings : unmergeMeeting)(
      workspace,
      meetingId,
      body.data.sourceMeetingId,
    );
    return Response.json({ updated: true });
  } catch (error) {
    if (error instanceof MeetingCompositionError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
export const GET = (request: Request, context: Context) =>
  handle(request, context, "GET");
export const POST = (request: Request, context: Context) =>
  handle(request, context, "POST");
export const DELETE = (request: Request, context: Context) =>
  handle(request, context, "DELETE");
