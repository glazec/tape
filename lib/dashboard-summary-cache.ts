import { unstable_cache } from "next/cache";

import type { CachedDashboardSummary } from "@/lib/dashboard-summary-cache-shared";
import { getMeetingDashboardSummaryForWorkspace } from "@/lib/meeting-queries";
import type { WorkspaceContext } from "@/lib/workspace";

const DASHBOARD_SUMMARY_CACHE_VERSION = "v1";
const DASHBOARD_SUMMARY_REVALIDATE_SECONDS = 60 * 60;

type DashboardSummaryOptions = {
  userEmail?: string | null;
  userName?: string | null;
};

export function getDashboardSummaryCacheTag(
  workspace: Pick<WorkspaceContext, "teamId" | "userId">,
) {
  return `dashboard-summary:${workspace.teamId}:${workspace.userId}`;
}

export function getCachedDashboardSummaryForWorkspace(
  workspace: WorkspaceContext,
  options: DashboardSummaryOptions = {},
) {
  const cachedSummary = unstable_cache(
    async (): Promise<CachedDashboardSummary> => ({
      cachedAt: new Date().toISOString(),
      summary: await getMeetingDashboardSummaryForWorkspace(
        workspace,
        options,
      ),
    }),
    [
      "dashboard-summary",
      DASHBOARD_SUMMARY_CACHE_VERSION,
      workspace.teamId,
      workspace.userId,
      options.userEmail ?? "",
      options.userName ?? "",
    ],
    {
      revalidate: DASHBOARD_SUMMARY_REVALIDATE_SECONDS,
      tags: [getDashboardSummaryCacheTag(workspace)],
    },
  );

  return cachedSummary();
}
