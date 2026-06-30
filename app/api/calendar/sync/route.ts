import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  RecallCalendarConnectionError,
  syncRecallCalendarEventsForWorkspace,
} from "@/lib/recall-calendar";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  autoJoinEnabled: z.boolean().optional().default(true),
});

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
    await assertCanCreateMeetings(workspace);

    const syncResult = await syncRecallCalendarEventsForWorkspace({
      workspace,
      autoJoinEnabled: result.data.autoJoinEnabled,
    });

    return Response.json(syncResult, { status: 202 });
  } catch (error) {
    if (error instanceof RecallCalendarConnectionError) {
      return Response.json(
        { error: "Recall Calendar is not connected", reconnect: true },
        { status: 409 },
      );
    }

    if (error instanceof SharedOnlyAccessError) {
      return Response.json(
        { error: "Shared users cannot add meetings" },
        { status: 403 },
      );
    }

    return Response.json(
      { error: "Recall Calendar sync unavailable" },
      { status: 502 },
    );
  }
}
