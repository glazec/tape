import type { ReactNode } from "react";
import { Bot } from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import type { DashboardWorkflowSummaryModel } from "@/lib/dashboard-workflow-summary";
import { cn } from "@/lib/utils";

type DashboardWorkflowSummaryProps = {
  summary: DashboardWorkflowSummaryModel;
};

export function DashboardWorkflowSummary({
  summary,
}: DashboardWorkflowSummaryProps) {
  return (
    <section
      aria-label="Meeting workflow summary"
      className="w-full"
    >
      <SummaryTile
        icon={<Bot />}
        label="Upcoming joins"
        value={summary.upcomingBotJoins}
        badge="Auto join"
        badgeVariant={summary.scheduledWithoutBot ? "destructive" : "secondary"}
        detail={<UpcomingJoinDetail summary={summary} />}
      />
    </section>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  badge,
  badgeVariant,
  detail,
  urgent = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  badge: string;
  badgeVariant: "secondary" | "destructive";
  detail: ReactNode;
  urgent?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-h-32 rounded-lg border bg-card p-4 text-card-foreground",
        urgent ? "border-destructive/30" : "border-border",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground [&>svg]:size-4">
            {icon}
          </span>
          <span className="truncate text-sm font-medium">{label}</span>
        </div>
        <Badge variant={badgeVariant}>{badge}</Badge>
      </div>
      <p className="mt-4 text-3xl font-semibold leading-none tabular-nums">
        {value}
      </p>
      <div className="mt-3 text-sm leading-6 text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

function UpcomingJoinDetail({
  summary,
}: {
  summary: DashboardWorkflowSummaryModel;
}) {
  if (summary.nextBotJoin) {
    return (
      <p className="min-w-0 break-words">
        Next:{" "}
        <span className="font-medium text-foreground">
          {summary.nextBotJoin.title}
        </span>{" "}
        <LocalDateTime value={summary.nextBotJoin.startedAt} />
      </p>
    );
  }

  if (summary.scheduledWithoutBot > 0) {
    return `${summary.scheduledWithoutBot} scheduled meetings have no bot.`;
  }

  return "No upcoming calendar joins.";
}
