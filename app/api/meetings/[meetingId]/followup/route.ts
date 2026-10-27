import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { getComposedMeetingForFollowup } from "@/lib/meeting-composition";
import { generateAndSaveMeetingFollowup } from "@/lib/meeting-followup-generation";
import { providerCreditErrorResponse } from "@/lib/provider-credit";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 150;
const requestSchema = z.strictObject({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { meetingId } = await context.params;
  if (!z.uuid().safeParse(meetingId).success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meeting = await getComposedMeetingForFollowup(workspace, meetingId);
  if (!meeting?.canManage) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Invalid followup request" },
      { status: 400 },
    );
  try {
    const outcome = await generateAndSaveMeetingFollowup({
      expectedSourceHash: parsed.data.sourceHash,
      meeting,
      meetingId,
      workspace,
    });

    switch (outcome.status) {
      case "saved":
        return Response.json(
          { result: outcome.result },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      case "not_found":
        return Response.json({ error: "Meeting not found" }, { status: 404 });
      case "too_long":
        return Response.json(
          { error: "This transcript is too long to generate a followup." },
          { status: 422 },
        );
      case "meeting_changed":
        return Response.json(
          { error: "The meeting changed. Refresh the meeting and try again." },
          { status: 409 },
        );
      case "not_ready":
      case "transcript_changed":
        return Response.json(
          { error: "The transcript changed. Refresh the meeting and try again." },
          { status: 409 },
        );
    }
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);
    if (creditResponse) return creditResponse;
    console.error("meeting_followup_generation_failed", {
      meetingId,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      { error: "Could not generate the followup. Please try again." },
      { status: 502 },
    );
  }
}
