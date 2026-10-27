import type { ReactNode } from "react";

import type {
  DashboardUserStats,
  DashboardWorkflowSummaryModel,
} from "@/lib/dashboard-workflow-summary";

type DashboardWorkflowSummaryProps = {
  summary: DashboardWorkflowSummaryModel;
};

export function DashboardWorkflowSummary({
  summary,
}: DashboardWorkflowSummaryProps) {
  return <UserStatsCard stats={summary.userStats} />;
}

function UserStatsCard({ stats }: { stats: DashboardUserStats }) {
  return (
    <p
      aria-label="This week activity"
      className="text-sm text-muted-foreground"
    >
      This week, <Stat>{formatMeetingCount(stats.thisWeekMeetings)}</Stat>{" "}
      over <Stat>{formatMeetingHours(stats.meetingHours)}</Stat>
      <span className="sr-only">
        {" "}
        in meetings, {stats.spokenWords.toLocaleString()} words
      </span>
      , {formatMeetingChange(stats)}.
    </p>
  );
}

function Stat({ children }: { children: ReactNode }) {
  return (
    <span className="tabular-nums text-foreground">{children}</span>
  );
}

function formatMeetingCount(count: number) {
  return count === 1
    ? "1 meeting"
    : `${count.toLocaleString()} meetings`;
}

function formatMeetingChange(stats: DashboardUserStats) {
  const change = stats.meetingChangePercent;

  if (change === 0) {
    return "the same as last week";
  }

  return `${Math.abs(change)}% ${change > 0 ? "more" : "fewer"} than last week`;
}

function formatMeetingHours(hours: number) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
