"use client";

import { useState } from "react";
import { AlertCircle, CalendarCheck, RefreshCw } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type SyncState = "idle" | "syncing" | "synced" | "error";

export function CalendarSyncButton() {
  const [state, setState] = useState<SyncState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function syncCalendar() {
    setState("syncing");
    setMessage(null);

    try {
      const response = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoJoinEnabled: true }),
      });

      if (!response.ok) {
        throw new Error("Calendar sync failed");
      }

      const result = (await response.json()) as { syncedEventCount?: number };
      const count = result.syncedEventCount ?? 0;

      setState("synced");
      setMessage(
        count === 1
          ? "Captured 1 upcoming calendar event."
          : `Captured ${count} upcoming calendar events.`,
      );
    } catch {
      setState("error");
      setMessage("Calendar events could not be captured.");
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Button type="button" onClick={syncCalendar} disabled={state === "syncing"}>
        <RefreshCw data-icon="inline-start" />
        {state === "syncing" ? "Syncing..." : "Sync calendar"}
      </Button>
      {message ? (
        <Alert
          variant={state === "error" ? "destructive" : "default"}
          className="max-w-md"
        >
          {state === "error" ? <AlertCircle /> : <CalendarCheck />}
          <AlertTitle>
            {state === "error" ? "Calendar not synced" : "Calendar synced"}
          </AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
