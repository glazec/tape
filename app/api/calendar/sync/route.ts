import { CalendarAccountSelectionError } from "@/lib/calendar-account-selection";
import { z } from "zod";
import { inngest } from "@/inngest/client";

import { getCurrentUser } from "@/lib/auth";
import { selectOrganizationWorkspace } from "@/lib/organization-workspaces";
import {
  listCalendarConnectionIdsForWorkspace,
  RecallCalendarConnectionError,
  syncRecallCalendarEventsForWorkspace,
} from "@/lib/recall-calendar";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import { providerCreditErrorResponse } from "@/lib/provider-credit";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  autoJoinEnabled: z.boolean().optional().default(true),
  connectionId: z.uuid().optional(),
  teamId: z.uuid().optional(),
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
    let workspace = await getOrCreateWorkspaceForSessionUser(user);
    if (result.data.teamId) {
      const selected = await selectOrganizationWorkspace(workspace, result.data.teamId);
      if (!selected) return Response.json({ error: "Forbidden" }, { status: 403 });
      workspace = selected;
    }
    await assertCanCreateMeetings(workspace);

    // A sync that names no account covers every connected account.
    const connectionIds = result.data.connectionId
      ? [result.data.connectionId]
      : await listCalendarConnectionIdsForWorkspace(workspace);
    const targets = connectionIds.length > 1 ? connectionIds : [result.data.connectionId];
    const syncResults: Awaited<ReturnType<typeof syncRecallCalendarEventsForWorkspace>>[] = [];
    let firstError: unknown = null;

    for (const connectionId of targets) {
      try {
        syncResults.push(
          await syncRecallCalendarEventsForWorkspace({
            workspace,
            autoJoinEnabled: result.data.autoJoinEnabled,
            ...(connectionId ? { connectionId } : {}),
          }),
        );
      } catch (error) {
        // One account failing should not hide events from the others.
        if (targets.length === 1) throw error;
        firstError ??= error;
        console.error("calendar_sync_account_failed", { connectionId, error });
      }
    }

    if (syncResults.length === 0) throw firstError;

    const requestedAt = new Date().toISOString();
    for (const syncResult of syncResults) {
      await inngest.send({
        name: "calendar/history.repair",
        data: {
          connectionId: syncResult.connectionId,
          teamId: workspace.teamId,
          userId: workspace.userId,
          requestedAt,
        },
      });
    }

    const summary =
      syncResults.length === 1
        ? syncResults[0]
        : {
            connectionId: syncResults[0].connectionId,
            failedEventCount: syncResults.reduce((sum, item) => sum + (item.failedEventCount ?? 0), 0),
            syncedEventCount: syncResults.reduce((sum, item) => sum + (item.syncedEventCount ?? 0), 0),
          };

    return Response.json({ ...summary, historyRepairQueued: true }, { status: 202 });
  } catch (error) {
    if (error instanceof CalendarAccountSelectionError) {
      return Response.json({ error: error.message, code: "calendar_account_required" }, { status: 409 });
    }
    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (error instanceof RecallCalendarConnectionError) {
      return Response.json(
        { error: "Calendar is not connected", reconnect: true },
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
      { error: "Calendar sync unavailable" },
      { status: 502 },
    );
  }
}
