import type { ReactNode } from "react";
import { Bot, CalendarCheck, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarSyncButton } from "@/components/calendar-sync-button";
import type { CalendarConnectionSummary } from "@/lib/calendar-connection-queries";

type CalendarAutomationPanelProps = {
  accountLabel?: string | null;
  autoSync: boolean;
  nextJoinTitle?: string | null;
  status: CalendarConnectionSummary;
};

export function CalendarAutomationPanel({
  accountLabel,
  autoSync,
  nextJoinTitle,
  status,
}: CalendarAutomationPanelProps) {
  const connected = status.connected;
  const autoJoinActive = connected && status.autoJoinEnabled;
  const statusLabel = connected ? "Connected" : "Needs connection";
  const statusVariant = connected ? "secondary" : "destructive";

  return (
    <Card size="sm" className="w-full sm:max-w-sm">
      <CardHeader>
        <CardTitle>Calendar capture</CardTitle>
        <CardDescription>
          Future meetings are watched from the connected calendar.
        </CardDescription>
        <CardAction>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm">
          <StatusRow
            icon={<CalendarCheck />}
            label={
              connected
                ? "Calendar connected"
                : "Calendar not connected"
            }
            value={
              connected
                ? (accountLabel ?? "Connected account")
                : "Connect calendar in Recall first"
            }
          />
          <StatusRow
            icon={<Bot />}
            label={
              autoJoinActive
                ? "Recording coverage on"
                : "Recording coverage off"
            }
            value={
              autoJoinActive
                ? nextJoinTitle
                  ? `Next join: ${nextJoinTitle}`
                  : "Supported online meetings will be recorded"
                : connected
                  ? "Sync calendar to enable recording"
                  : "Connect calendar in Recall first"
            }
          />
          <StatusRow
            icon={<Clock3 />}
            label="Last checked"
            value={formatLastSynced(status.recallCalendarLastSyncedAt)}
          />
        </div>
        <CalendarSyncButton autoSync={autoSync} connected={connected} />
      </CardContent>
    </Card>
  );
}

function StatusRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[1rem_1fr] gap-x-2">
      <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium leading-5">{label}</span>
        <span className="block text-muted-foreground">{value}</span>
      </span>
    </div>
  );
}

function formatLastSynced(value: string | null) {
  if (!value) {
    return "No sync yet";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
