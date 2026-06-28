import type { ReactNode } from "react";
import { Bot, Mic2 } from "lucide-react";

import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import type {
  DashboardUserStats,
  DashboardWorkflowSummaryModel,
} from "@/lib/dashboard-workflow-summary";
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
      className="grid w-full gap-4"
    >
      <SummaryTile
        icon={<Bot />}
        label="Upcoming joins"
        value={summary.upcomingBotJoins}
        badge="Auto join"
        badgeVariant={summary.scheduledWithoutBot ? "destructive" : "secondary"}
        detail={<UpcomingJoinDetail summary={summary} />}
      />
      <UserStatsTile stats={summary.userStats} />
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

function UserStatsTile({ stats }: { stats: DashboardUserStats }) {
  return (
    <div className="min-h-32 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-muted-foreground [&>svg]:size-4">
            <Mic2 />
          </span>
          <span className="truncate text-sm font-medium">Your 7 days</span>
        </div>
        <Badge variant="secondary">{getMeetingDeltaBadge(stats)}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <StatBlock
          label="Meetings"
          value={stats.last7DaysMeetings.toLocaleString()}
        />
        <StatBlock
          label="Meeting time"
          value={formatMeetingHours(stats.meetingHours)}
        />
      </div>

      <dl className="mt-4 grid gap-2 border-t border-border/70 pt-3 text-sm leading-5">
        <StatRow label="Change" value={formatMeetingChange(stats)} />
        <StatRow label="Words" value={formatWordsAndTalkShare(stats)} />
        <StatRow label="Tone" value={formatMeetingTone(stats)} />
      </dl>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-3xl font-semibold leading-none tabular-nums text-foreground">
        {value}
      </p>
      <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
      <dt className="min-w-0 truncate text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

function getMeetingDeltaBadge(stats: DashboardUserStats) {
  return formatSignedPercent(stats.meetingChangePercent);
}

function formatMeetingChange(stats: DashboardUserStats) {
  return `${formatSignedPercent(stats.meetingChangePercent)} vs previous 7 days`;
}

function formatSignedPercent(value: number) {
  return value > 0 ? `+${value}%` : `${value}%`;
}

function formatMeetingHours(hours: number) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

function formatWordsAndTalkShare(stats: DashboardUserStats) {
  const talkShare =
    stats.talkSharePercent === null
      ? "talk share unavailable"
      : `${stats.talkSharePercent}% talk share`;

  return `${stats.spokenWords.toLocaleString()} words, ${talkShare}`;
}

function formatMeetingTone(stats: DashboardUserStats) {
  if (!stats.dominantEmotion) {
    return "No tone yet";
  }

  const emotion = formatEmotionName(stats.dominantEmotion);

  return stats.dominantEmotionPercent === null
    ? emotion
    : `${emotion} ${stats.dominantEmotionPercent}%`;
}

function formatEmotionName(emotion: DashboardUserStats["dominantEmotion"]) {
  if (!emotion) {
    return "";
  }

  return `${emotion.charAt(0).toUpperCase()}${emotion.slice(1)}`;
}
