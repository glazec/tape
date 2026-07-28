import type { DashboardWorkflowSummaryModel } from "@/lib/dashboard-workflow-summary";

export const DASHBOARD_SUMMARY_FRESH_MS = 15_000;

export type CachedDashboardSummary = {
  cachedAt: string;
  summary: DashboardWorkflowSummaryModel;
};

export function isDashboardSummaryStale(
  cachedAt: string,
  now = Date.now(),
) {
  const cachedTime = new Date(cachedAt).getTime();

  return (
    !Number.isFinite(cachedTime) ||
    now - cachedTime >= DASHBOARD_SUMMARY_FRESH_MS
  );
}
