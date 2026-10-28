import Link from "next/link";

import { CalendarSyncButton } from "@/components/calendar-sync-button";
import { LocalDateTime } from "@/components/local-date-time";
import type { CalendarConnectionSummary } from "@/lib/calendar-connection-queries";
import { cn } from "@/lib/utils";

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
  const accounts = status.accounts ?? null;
  // A multi-account summary carries coverage per account, not at the top.
  const autoJoinActive = accounts
    ? accounts.some((account) => account.connected && account.autoJoinEnabled)
    : connected && status.autoJoinEnabled;

  return (
    <section
      aria-label="Calendar"
      className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4"
    >
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground sm:justify-end">
        <span
          aria-hidden="true"
          className={cn(
            "mr-0.5 size-1.5 rounded-full",
            autoJoinActive ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
        {connected ? (
          <>
            <span className="sr-only">
              {autoJoinActive
                ? "Recording coverage on"
                : "Recording coverage off"}
              .{" "}
            </span>
            <span className="text-foreground">
              {autoJoinActive
                ? nextJoinTitle
                  ? `Next join: ${nextJoinTitle}`
                  : "Meet and Zoom use bots; Teams uses Tape for Mac"
                : "Sync calendar to enable recording"}
            </span>
            {accounts ? (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  className="underline decoration-border underline-offset-4 hover:text-foreground hover:decoration-foreground"
                  href="/settings/team#connected-accounts"
                >
                  <span className="sr-only">
                    Calendar status: Connected.{" "}
                  </span>
                  {accounts.length === 1
                    ? "1 calendar account"
                    : `${accounts.length} calendar accounts`}
                  <span className="sr-only">. Manage connected accounts</span>
                </Link>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <span className="whitespace-nowrap">
                  <span className="sr-only">
                    Calendar status: Connected,{" "}
                    {status.accountEmail ?? accountLabel ?? "Connected account"}
                    .{" "}
                  </span>
                  Last checked{" "}
                  {formatLastSynced(status.recallCalendarLastSyncedAt)}
                </span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="text-foreground">
              Calendar <span className="sr-only">status: </span>Not connected
            </span>
            <span className="sr-only">
              . Connect Google Calendar to record and transcribe meetings
              automatically.
            </span>
          </>
        )}
      </p>
      <CalendarSyncButton
        autoSync={autoSync}
        connected={connected}
        connectionId={accounts ? undefined : status.connectionId}
        multipleAccounts={Boolean(accounts)}
        size="sm"
        teamId={status.teamId}
      />
    </section>
  );
}

function formatLastSynced(value: string | null) {
  if (!value) {
    return "No sync yet";
  }

  return <LocalDateTime value={value} />;
}
