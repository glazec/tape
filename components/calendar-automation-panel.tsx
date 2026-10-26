import type { ReactNode } from "react";
import Link from "next/link";
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
          {status.accounts?.length ? `${status.accounts.length} calendar accounts` : connected
            ? (status.accountEmail ?? accountLabel ?? "Connected account")
            : "Connect Google Calendar to record and transcribe meetings automatically."}
        </CardDescription>
        <CardAction>
          <Badge variant={connected ? "secondary" : "outline"}>
            {connected ? "Connected" : "Not connected"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {connected && !status.accounts ? (
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
                    : "Meet and Zoom use bots; Teams uses Tape for Mac"
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
        {status.accounts ? <ul className="space-y-4">
          {status.accounts.map((account) => <li key={account.connectionId} className="space-y-2">
            <p className="break-all text-sm font-medium">{account.accountEmail ?? "Google account"}</p>
            <p className="text-xs text-muted-foreground">{account.recallCalendarStatus === "connected" ? account.autoJoinEnabled ? "Recording coverage on" : "Recording coverage off" : "Needs attention"}</p>
            <CalendarSyncButton connected={account.connected} connectionId={account.connectionId} teamId={account.teamId} />
          </li>)}
        </ul> : <CalendarSyncButton autoSync={autoSync} connected={connected} connectionId={status.connectionId} teamId={status.teamId} />}
        <Link className="self-end text-sm underline underline-offset-4" href="/settings/team#connected-accounts">
          Manage connected accounts
        </Link>
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
      <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-3.5">
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
