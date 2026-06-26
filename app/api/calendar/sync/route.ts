import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  GoogleCalendarAccessTokenError,
  syncGooglePrimaryCalendarEvents,
} from "@/lib/google-calendar";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const requestSchema = z
  .object({
    autoJoinEnabled: z.boolean().optional().default(true),
  })
  .strict();

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const result = requestSchema.safeParse(body);

  if (!result.success) {
    return Response.json(
      { error: "Invalid calendar sync request" },
      { status: 400 },
    );
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    const syncResult = await syncGooglePrimaryCalendarEvents({
      sessionUser: user,
      workspace,
      autoJoinEnabled: result.data.autoJoinEnabled,
    });

    return Response.json(syncResult, { status: 202 });
  } catch (error) {
    if (error instanceof GoogleCalendarAccessTokenError) {
      return Response.json(
        { error: "Google Calendar access is not connected" },
        { status: 409 },
      );
    }

    return Response.json(
      { error: "Google Calendar sync unavailable" },
      { status: 502 },
    );
  }
}
