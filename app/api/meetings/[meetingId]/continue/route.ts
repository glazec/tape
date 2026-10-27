import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { continueMeetingRecording } from "@/lib/meeting-continuation";
import { MeetingCompositionError } from "@/lib/meeting-composition";
import { providerCreditErrorResponse } from "@/lib/provider-credit";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success)
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  const body = z
    .strictObject({ meetingUrl: z.url() })
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "Enter a valid meeting link." },
      { status: 400 },
    );
  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user, {
      meetingId,
    });
    return Response.json(
      await continueMeetingRecording(
        workspace,
        meetingId,
        body.data.meetingUrl,
      ),
    );
  } catch (error) {
    if (error instanceof MeetingCompositionError)
      return Response.json({ error: error.message }, { status: error.status });
    const creditResponse = providerCreditErrorResponse(error);
    if (creditResponse) return creditResponse;
    console.error("meeting_continuation_failed", {
      meetingId,
      errorType: error instanceof Error ? error.name : "Unknown",
    });
    return Response.json(
      { error: "Unable to continue recording. Try again." },
      { status: 502 },
    );
  }
}
