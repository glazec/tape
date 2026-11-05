import { z } from "zod";

import { SharedOnlyAccessError } from "@/lib/access-errors";
import { getCurrentUser } from "@/lib/auth";
import {
  MeetingLinkReplacementUnavailableError,
  replaceMeetingLink,
  SameMeetingLinkError,
  UnsupportedMeetingLinkError,
} from "@/lib/meeting-link-replacement";
import { providerCreditErrorResponse } from "@/lib/provider-credit";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();
const requestSchema = z.strictObject({ meetingUrl: z.url().max(2048) });

export async function PUT(
  request: Request,
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

  const body = await request.json().catch(() => null);
  const parsedBody = requestSchema.safeParse(body);

  if (!parsedBody.success) {
    return Response.json({ error: "Enter a valid meeting link" }, { status: 400 });
  }

  try {
    const result = await replaceMeetingLink({
      meetingId: parsedMeetingId.data,
      meetingUrl: parsedBody.data.meetingUrl,
      sessionUser: user,
    });

    return Response.json(result);
  } catch (error) {
    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (
      error instanceof UnsupportedMeetingLinkError ||
      error instanceof SameMeetingLinkError
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof MeetingLinkReplacementUnavailableError) {
      return Response.json({ error: error.message }, { status: 409 });
    }

    if (error instanceof SharedOnlyAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    console.error("meeting_link_replacement_failure", {
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      meetingId: parsedMeetingId.data,
      userId: user.id,
    });

    return Response.json(
      { error: "The bot could not be sent to the new link" },
      { status: 502 },
    );
  }
}
