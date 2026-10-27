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
  const autoJoinActive = connected && status.autoJoinEnabled;

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
          {connected ? (
            <>
              Calendar <span className="sr-only">status: </span>Connected
              {" · "}
              {accountLabel ?? "Connected account"}
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
      <CalendarSyncButton
        autoSync={autoSync}
        connected={connected}
        size="sm"
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
