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
      className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-end sm:gap-4"
    >
      <div className="min-w-0 text-sm sm:text-right">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:justify-end">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              autoJoinActive ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
          {connected ? (
            <>
              <span>
                {autoJoinActive
                  ? "Recording coverage on"
                  : "Recording coverage off"}
              </span>
              <span className="text-muted-foreground">
                {autoJoinActive
                  ? nextJoinTitle
                    ? `Next join: ${nextJoinTitle}`
                    : "Meet and Zoom use bots; Teams uses Tape for Mac"
                  : "Sync calendar to enable recording"}
              </span>
            </>
          ) : (
            <span>Calendar not connected</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {accounts ? (
            <>
              Calendar <span className="sr-only">status: </span>
              {connected ? "Connected" : "Not connected"}
              {" · "}
              {accounts.length === 1
                ? "1 calendar account"
                : `${accounts.length} calendar accounts`}
              {" · "}
              <Link
                className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                href="/settings/team#connected-accounts"
              >
                Manage connected accounts
              </Link>
            </>
          ) : connected ? (
            <>
              Calendar <span className="sr-only">status: </span>Connected
              {" · "}
              {status.accountEmail ?? accountLabel ?? "Connected account"}
              {" · Last checked "}
              {formatLastSynced(status.recallCalendarLastSyncedAt)}
            </>
          ) : (
            <>
              <span className="sr-only">Calendar: Not connected. </span>
              Connect Google Calendar to record and transcribe meetings
              automatically.
            </>
          )}
        </p>
      </div>
      {accounts ? null : (
        <CalendarSyncButton
          autoSync={autoSync}
          connected={connected}
          connectionId={status.connectionId}
          size="sm"
          teamId={status.teamId}
        />
      )}
    </section>
  );
}

function formatLastSynced(value: string | null) {
  if (!value) {
    return "No sync yet";
  }

  return <LocalDateTime value={value} />;
}
