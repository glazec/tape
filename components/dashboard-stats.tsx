"use client";

import { useEffect, useState } from "react";

import { DashboardWorkflowSummary } from "@/components/dashboard-workflow-summary";
import {
  isDashboardSummaryStale,
  type CachedDashboardSummary,
} from "@/lib/dashboard-summary-cache-shared";

export function DashboardStats({
  initialResult,
  name,
}: {
  initialResult: CachedDashboardSummary;
  name: string;
}) {
  const [freshResult, setFreshResult] =
    useState<CachedDashboardSummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const displayedResult =
    freshResult &&
    new Date(freshResult.cachedAt).getTime() >
      new Date(initialResult.cachedAt).getTime()
      ? freshResult
      : initialResult;

  useEffect(() => {
    if (!isDashboardSummaryStale(initialResult.cachedAt)) {
      return;
    }

    const controller = new AbortController();

    async function refreshSummary() {
      setIsRefreshing(true);

      try {
        const response = await fetch("/api/dashboard/summary/refresh", {
          method: "POST",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as CachedDashboardSummary;

        if (!controller.signal.aborted) {
          setFreshResult(result);
        }
      } catch {
        // Keep showing the cached summary when a background refresh fails.
      } finally {
        if (!controller.signal.aborted) {
          setIsRefreshing(false);
        }
      }
    }

    void refreshSummary();

    return () => controller.abort();
  }, [initialResult.cachedAt]);

  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">
        Welcome back, {name}.
      </h1>
      <div className="mt-2">
        <DashboardWorkflowSummary summary={displayedResult.summary} />
      </div>
      {isRefreshing ? (
        <span className="sr-only" role="status">
          Updating dashboard activity
        </span>
      ) : null}
    </div>
  );
}
