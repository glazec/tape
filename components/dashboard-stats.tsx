"use client";

import { useEffect, useState } from "react";
import { CalendarCheck2 } from "lucide-react";

import { DashboardWorkflowSummary } from "@/components/dashboard-workflow-summary";
import { Card, CardContent } from "@/components/ui/card";
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
    <>
      <DashboardGreetingCard
        meetingCount={displayedResult.summary.userStats.thisWeekMeetings}
        name={name}
      />
      <DashboardWorkflowSummary summary={displayedResult.summary} />
      {isRefreshing ? (
        <span className="sr-only" role="status">
          Updating dashboard activity
        </span>
      ) : null}
    </>
  );
}

function DashboardGreetingCard({
  meetingCount,
  name,
}: {
  meetingCount: number;
  name: string;
}) {
  return (
    <Card className="relative min-h-36 overflow-hidden lg:row-span-2 lg:min-h-60">
      <CardContent className="flex flex-1 flex-col justify-center py-6 sm:px-7 sm:py-7">
        <div className="relative z-10 max-w-sm">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] sm:text-[1.75rem]">
            Welcome back, {name}.
          </h1>
          <p className="mt-2.5 text-[0.9375rem] leading-[1.6] text-muted-foreground">
            {formatGreetingSummary(meetingCount)}
          </p>
        </div>
        <CalendarCheck2
          aria-hidden="true"
          className="absolute right-6 bottom-6 size-20 text-foreground/[0.06] sm:right-7 sm:bottom-7 sm:size-28"
        />
      </CardContent>
    </Card>
  );
}

function formatGreetingSummary(meetingCount: number) {
  return meetingCount === 1
    ? "You had 1 meeting since Monday."
    : `You had ${meetingCount.toLocaleString()} meetings since Monday.`;
}
