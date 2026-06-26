"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarCheck, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { connectGoogleCalendar } from "@/lib/google-calendar-auth";

type SyncState =
  | "idle"
  | "syncing"
  | "synced"
  | "needs_connection"
  | "connecting"
  | "error";

type CalendarSyncButtonProps = {
  autoSync?: boolean;
};

type CalendarSyncResponse = {
  error?: string;
  reconnect?: boolean;
  syncedEventCount?: number;
};

export function CalendarSyncButton({ autoSync = false }: CalendarSyncButtonProps) {
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
          setMessage("Connect Google Calendar to grant calendar read access.");
          return;
        }

        throw new Error("Calendar sync failed");
      }

      const count = result.syncedEventCount ?? 0;

      setState("synced");
      setMessage(
        count === 1
          ? "Captured 1 upcoming calendar event."
          : `Captured ${count} upcoming calendar events.`,
      );

      if (autoSync) {
        router.replace("/dashboard");
      }
    } catch {
      setState("error");
      setMessage("Calendar events could not be captured.");
    }
  }, [autoSync, router]);

  useEffect(() => {
    if (!autoSync || autoSyncAttempted.current) {
      return;
    }

    autoSyncAttempted.current = true;
    void syncCalendar();
  }, [autoSync, syncCalendar]);

  async function connectCalendar() {
    setState("connecting");
    setMessage(null);

    try {
      const result = await connectGoogleCalendar(authClient);

      if (!result.ok) {
        setState("needs_connection");
        setMessage(result.message);
        return;
      }
    } catch {
      setState("needs_connection");
      setMessage("Google Calendar could not connect.");
    }
  }

  const needsConnection = state === "needs_connection";
  const isBusy = state === "syncing" || state === "connecting";
  const buttonLabel =
    state === "syncing"
      ? "Syncing..."
      : state === "connecting"
        ? "Opening Google..."
        : needsConnection
          ? "Connect calendar"
          : "Sync calendar";
  const alertTitle =
    state === "error"
      ? "Calendar not synced"
      : needsConnection
        ? "Calendar access needed"
        : "Calendar synced";

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        type="button"
        onClick={needsConnection ? connectCalendar : syncCalendar}
        disabled={isBusy}
      >
        <RefreshCw data-icon="inline-start" />
        {buttonLabel}
      </Button>
      {message ? (
        <Alert
          variant={state === "error" ? "destructive" : "default"}
          className="max-w-md"
        >
          {state === "error" || needsConnection ? (
            <AlertCircle />
          ) : (
            <CalendarCheck />
          )}
          <AlertTitle>{alertTitle}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{message}</span>
            {needsConnection ? (
              <Button
                type="button"
                onClick={connectCalendar}
                disabled={isBusy}
                size="sm"
              >
                Connect Google Calendar
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
