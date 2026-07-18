import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card aria-label="This week activity" className="h-full">
      <CardHeader>
        <CardTitle>This week</CardTitle>
        <CardDescription>Meeting activity from the last 7 days.</CardDescription>
        <CardAction>
          <Badge variant="secondary">{formatMeetingChange(stats)}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <StatBlock
            label="Meetings"
            value={stats.last7DaysMeetings.toLocaleString()}
          />
          <StatBlock
            label="Meeting time"
            value={formatMeetingHours(stats.meetingHours)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <StatBlock
            detail={formatTalkShare(stats)}
            label="Words"
            value={stats.spokenWords.toLocaleString()}
          />
          <StatBlock label="Tone" value={formatMeetingTone(stats)} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatBlock({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-2xl font-semibold leading-none tabular-nums text-foreground sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
        {label}
      </p>
      {detail ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
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

function formatTalkShare(stats: DashboardUserStats) {
  return stats.talkSharePercent === null
    ? "Talk share unavailable"
    : `${stats.talkSharePercent}% talk share`;
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
