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
      className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground"
    >
      <span className="font-medium text-foreground">This week</span>
      <Stat>{formatMeetingCount(stats.thisWeekMeetings)}</Stat>
      <Separator />
      <Stat>{formatMeetingHours(stats.meetingHours)} in meetings</Stat>
      <Separator />
      <Stat>{stats.spokenWords.toLocaleString()} words</Stat>
      <Separator />
      <span>{formatMeetingChange(stats)}</span>
    </p>
  );
}

function Stat({ children }: { children: ReactNode }) {
  return (
    <span className="font-medium tabular-nums text-foreground">{children}</span>
  );
}

function formatMeetingCount(count: number) {
  return count === 1
    ? "1 meeting"
    : `${count.toLocaleString()} meetings`;
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-border">
      /
    </span>
  );
}

function formatMeetingChange(stats: DashboardUserStats) {
  return `${formatSignedPercent(stats.meetingChangePercent)} vs last week`;
}

function formatSignedPercent(value: number) {
  return value > 0 ? `+${value}%` : `${value}%`;
}

function formatMeetingHours(hours: number) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}
