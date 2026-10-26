import { SharedOnlyAccessError } from "@/lib/access-errors";
import { getCurrentUser } from "@/lib/auth";
import { z } from "zod";
import { selectOrganizationWorkspace } from "@/lib/organization-workspaces";
import { disconnectGoogleCalendarForWorkspace } from "@/lib/google-calendar-oauth";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const result = z.strictObject({ connectionId: z.uuid().optional(), teamId: z.uuid().optional() }).safeParse(body);
    if (!result.success) return Response.json({ error: "Invalid calendar disconnect request" }, { status: 400 });
    let workspace = await getOrCreateWorkspaceForSessionUser(user);
    if (result.data.teamId) {
      const selected = await selectOrganizationWorkspace(workspace, result.data.teamId);
      if (!selected) return Response.json({ error: "Forbidden" }, { status: 403 });
      workspace = selected;
    }
    await assertCanCreateMeetings(workspace);

    const disconnected = result.data.connectionId
      ? await disconnectGoogleCalendarForWorkspace(workspace, result.data.connectionId)
      : await disconnectGoogleCalendarForWorkspace(workspace);

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
