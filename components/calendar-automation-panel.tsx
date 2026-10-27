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
      className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-6"
    >
      <div className="min-w-0 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              autoJoinActive ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
          <span className="font-medium">Calendar</span>
          <span className="text-muted-foreground">
            {connected ? "Connected" : "Not connected"}
          </span>
          {connected ? (
            <span className="truncate text-muted-foreground">
              {accountLabel ?? "Connected account"}
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-muted-foreground">
          {connected ? (
            <>
              <span className="text-foreground">
                {autoJoinActive
                  ? "Recording coverage on"
                  : "Recording coverage off"}
              </span>
              {" · "}
              {autoJoinActive
                ? nextJoinTitle
                  ? `Next join: ${nextJoinTitle}`
                  : "Meet and Zoom use bots; Teams uses Tape for Mac"
                : "Sync calendar to enable recording"}
              {" · "}
              Last checked {formatLastSynced(status.recallCalendarLastSyncedAt)}
            </>
          ) : (
            "Connect Google Calendar to record and transcribe meetings automatically."
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
