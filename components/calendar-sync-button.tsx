"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarCheck, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type SyncState =
  | "idle"
  | "syncing"
  | "synced"
  | "partial"
  | "needs_connection"
  | "connecting"
  | "disconnecting"
  | "error";

type CalendarSyncButtonProps = {
  autoSync?: boolean;
  connected?: boolean;
};

type CalendarSyncResponse = {
  error?: string;
  failedEventCount?: number;
  reconnect?: boolean;
  syncedEventCount?: number;
};

export function getCalendarSyncPostSuccessAction(autoSync: boolean) {
  return autoSync
    ? ({ href: "/dashboard", type: "replace" } as const)
    : ({ type: "refresh" } as const);
}

export function formatCalendarSyncMessage(result: CalendarSyncResponse) {
  const count = result.syncedEventCount ?? 0;
  const failedCount = result.failedEventCount ?? 0;
  const capturedMessage =
    count === 1
      ? "Captured 1 upcoming calendar event."
      : `Captured ${count} upcoming calendar events.`;

  if (failedCount === 0) {
    return capturedMessage;
  }

  const reviewMessage =
    failedCount === 1
      ? "1 event needs review."
      : `${failedCount} events need review.`;

  if (count === 0) {
    return `Calendar checked. ${reviewMessage}`;
  }

  return `${capturedMessage} ${reviewMessage}`;
}

export function CalendarSyncButton({
  autoSync = false,
  connected = true,
}: CalendarSyncButtonProps) {
  const router = useRouter();
  const autoSyncAttempted = useRef(false);
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const syncCalendar = useCallback(async () => {
    setState("syncing");
    setMessage(null);

    try {
      const response = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoJoinEnabled: true }),
      });
      const result = (await response.json().catch(() => ({}))) as
        CalendarSyncResponse;

      if (!response.ok) {
        if (response.status === 409 && result.reconnect) {
          setState("needs_connection");
          setMessage("Calendar access expired. Connect again to keep capturing meetings.");
          return;
        }

        throw new Error("Calendar sync failed");
      }

      setState(result.failedEventCount ? "partial" : "synced");
      setMessage(formatCalendarSyncMessage(result));

      const postSuccessAction = getCalendarSyncPostSuccessAction(autoSync);

      if (postSuccessAction.type === "replace") {
        router.replace(postSuccessAction.href);
      } else {
        router.refresh();
      }
    } catch {
      setState("error");
      setMessage("Calendar events could not be captured. Try syncing again.");
    }
  }, [autoSync, router]);

  useEffect(() => {
    if (!autoSync || autoSyncAttempted.current) {
      return;
    }

    autoSyncAttempted.current = true;
    void syncCalendar();
  }, [autoSync, syncCalendar]);

  function connectCalendar() {
    setState("connecting");
    setMessage(null);
    window.location.href = "/api/calendar/oauth/start";
  }

  async function disconnectCalendar() {
    const confirmed = window.confirm(
      "Disconnect your calendar? Future scheduled calendar bots will be removed. Existing meeting transcripts will stay.",
    );

    if (!confirmed) {
      return;
    }

    setState("disconnecting");
    setMessage(null);

    try {
      const response = await fetch("/api/calendar/disconnect", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Calendar disconnect failed");
      }

      setState("needs_connection");
      setMessage("Calendar disconnected. Existing meeting transcripts were kept.");
      router.refresh();
    } catch {
      setState("error");
      setMessage("Calendar could not be disconnected.");
    }
  }

  const needsConnection = state === "needs_connection" || !connected;
  const isBusy =
    state === "syncing" ||
    state === "connecting" ||
    state === "disconnecting";
  const buttonLabel =
    state === "syncing"
      ? "Syncing..."
      : state === "connecting"
        ? "Opening Google..."
        : needsConnection
          ? "Connect calendar"
          : "Sync calendar";

  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          onClick={needsConnection ? connectCalendar : syncCalendar}
          disabled={isBusy}
          variant={needsConnection ? "default" : "outline"}
        >
          {needsConnection ? (
            <CalendarCheck data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          {buttonLabel}
        </Button>
        {!needsConnection ? (
          <Button
            type="button"
            onClick={disconnectCalendar}
            disabled={isBusy}
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          >
            {state === "disconnecting" ? "Disconnecting..." : "Disconnect"}
          </Button>
        ) : null}
      </div>
      {message ? (
        <p
          role="status"
          className={
            state === "error"
              ? "flex items-start gap-1.5 text-sm text-destructive"
              : "flex items-start gap-1.5 text-sm text-muted-foreground"
          }
        >
          {state === "error" || needsConnection ? (
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          ) : (
            <CalendarCheck className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}
