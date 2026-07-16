import { SharedOnlyAccessError } from "@/lib/access-errors";
import { getCurrentUser } from "@/lib/auth";
import { disconnectGoogleCalendarForWorkspace } from "@/lib/google-calendar-oauth";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST() {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);

    const disconnected = await disconnectGoogleCalendarForWorkspace(workspace);

    return Response.json({ disconnected });
  } catch (error) {
    if (error instanceof SharedOnlyAccessError) {
      return Response.json(
        { error: "Shared users cannot manage calendars" },
        { status: 403 },
      );
    }

    console.error("calendar_disconnect_failed", {
      error: serializeError(error),
      userId: user.id,
    });

    return Response.json(
      { error: "Calendar disconnect unavailable" },
      { status: 502 },
    );
  }
}

function serializeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message, name: error.name }
    : { message: "Unknown error", name: "UnknownError" };
}
