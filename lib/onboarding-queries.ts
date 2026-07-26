import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { auditEvents, localRecorderDevices } from "@/db/schema";
import type { WorkspaceContext } from "@/lib/workspace";

export type OnboardingSetupActivity = {
  desktopAppConnected: boolean;
  mcpUsed: boolean;
};

export async function getOnboardingSetupActivityForWorkspace(
  workspace: WorkspaceContext,
): Promise<OnboardingSetupActivity> {
  const [desktopDevices, mcpEvents] = await Promise.all([
    db
      .select({ id: localRecorderDevices.id })
      .from(localRecorderDevices)
      .where(
        and(
          eq(localRecorderDevices.teamId, workspace.teamId),
          eq(localRecorderDevices.userId, workspace.userId),
        ),
      )
      .limit(1),
    db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.teamId, workspace.teamId),
          eq(auditEvents.actorUserId, workspace.userId),
          eq(auditEvents.action, "onboarding_mcp_used"),
        ),
      )
      .limit(1),
  ]);

  return {
    desktopAppConnected: desktopDevices.length > 0,
    mcpUsed: mcpEvents.length > 0,
  };
}
