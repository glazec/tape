import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import {
  joinScheduledMeetingBotNow,
  MeetingBotJoinUnavailableError,
} from "@/lib/meeting-bot-join";
import { providerCreditErrorResponse } from "@/lib/provider-credit";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();

export async function POST(
  _request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId } = await context.params;
  const parsedMeetingId = meetingIdSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  try {
    await joinScheduledMeetingBotNow({
      meetingId: parsedMeetingId.data,
      sessionUser: user,
    });
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (error instanceof MeetingBotJoinUnavailableError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    if (error instanceof SharedOnlyAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    console.error("meeting_bot_early_join_failure", {
      meetingId: parsedMeetingId.data,
      userId: user.id,
    });

    return Response.json({ error: "Meeting bot could not join" }, { status: 502 });
  }

  return Response.json({
    meetingId: parsedMeetingId.data,
    status: "joining",
  });
}
