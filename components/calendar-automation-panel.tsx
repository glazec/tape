import type { ReactNode } from "react";
import { Bot, Clock3 } from "lucide-react";

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
import { LocalDateTime } from "@/components/local-date-time";
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

  return (
    <Card size="sm" className="h-full w-full shadow-sm">
      <CardHeader className="border-b bg-muted/35">
        <CardTitle>Calendar</CardTitle>
        <CardDescription>
          {connected
            ? (accountLabel ?? "Connected account")
            : "Connect Google Calendar to record and transcribe meetings automatically."}
        </CardDescription>
        <CardAction>
          <Badge variant={connected ? "secondary" : "destructive"}>
            {connected ? "Connected" : "Not connected"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connected ? (
          <div className="grid gap-3 text-sm">
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
                  : "Sync calendar to enable recording"
              }
            />
            <StatusRow
              icon={<Clock3 />}
              label="Last checked"
              value={formatLastSynced(status.recallCalendarLastSyncedAt)}
            />
          </div>
        ) : null}
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
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.5rem_1fr] gap-x-2">
      <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary [&>svg]:size-3.5">
        {icon}
      </span>
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

  return <LocalDateTime value={value} />;
}
