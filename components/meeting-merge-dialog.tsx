"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MergeMeeting = {
  id: string;
  title: string;
  startedAt: string | null;
  status: string;
};

type MeetingMergeDialogProps = {
  meetingId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus: RefObject<HTMLElement | null>;
};

export function MeetingMergeDialog({
  meetingId,
  title,
  open,
  onOpenChange,
  finalFocus,
}: MeetingMergeDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MergeMeeting[]>([]);
  const [merged, setMerged] = useState<MergeMeeting[]>([]);
  const [selected, setSelected] = useState<MergeMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastMerged, setLastMerged] = useState<MergeMeeting | null>(null);
  const [revision, setRevision] = useState(0);
  const requestInFlight = useRef(false);
  const endpoint = `/api/meetings/${encodeURIComponent(meetingId)}/merge`;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await fetch(
            `${endpoint}?query=${encodeURIComponent(query.trim())}`,
            { signal: controller.signal },
          );
          if (!response.ok)
            throw new Error("Meetings could not be loaded. Try again.");
          const body = (await response.json()) as {
            candidates: MergeMeeting[];
            merged: MergeMeeting[];
          };
          if (!controller.signal.aborted) {
            setCandidates(body.candidates);
            setMerged(body.merged);
            setSelected(
              (current) =>
                body.candidates.find((meeting) => meeting.id === current?.id) ??
                null,
            );
          }
        } catch (cause) {
          if (!controller.signal.aborted)
            setError(
              cause instanceof Error
                ? cause.message
                : "Meetings could not be loaded. Try again.",
            );
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, open, query, revision]);

  useEffect(() => {
    if (!notice || error || open) return;
    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice, error, open]);

  async function changeMerge(source: MergeMeeting, method: "POST" | "DELETE") {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceMeetingId: source.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "The meeting could not be updated. Try again.",
        );
      setNotice(method === "POST" ? "Meetings merged." : "Merge undone.");
      setLastMerged(method === "POST" ? source : null);
      setSelected(null);
      if (method === "POST") onOpenChange(false);
      else setRevision((value) => value + 1);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The meeting could not be updated. Try again.",
      );
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (notice || error) ? (
        <div
          className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-lg items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm shadow-lg"
          role={error ? "alert" : "status"}
        >
          <span
            className={`min-w-0 flex-1 ${error ? "text-destructive" : "text-foreground"}`}
          >
            {error ?? notice}
          </span>
          {lastMerged ? (
            <Button
              className="min-h-11 shrink-0"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void changeMerge(lastMerged, "DELETE")}
            >
              <Undo2 data-icon="inline-start" />
              {busy ? "Separating" : "Undo merge"}
            </Button>
          ) : null}
          <Button
            className="size-11 shrink-0 text-muted-foreground"
            aria-label="Dismiss notification"
            size="icon"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setNotice(null);
              setError(null);
            }}
          >
            <X />
          </Button>
        </div>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) onOpenChange(value);
        }}
      >
        <DialogContent
          finalFocus={finalFocus}
          className="flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col overflow-hidden p-0"
        >
          <div className="shrink-0 px-5 pt-5 pb-4">
            <DialogTitle>Merge meetings</DialogTitle>
            <DialogDescription className="mt-2">
              Bring another recording into this conversation.
            </DialogDescription>
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5">
            <div className="rounded-lg bg-muted/45 px-3 py-3">
              <p className="text-xs text-muted-foreground">Adding to</p>
              <p className="mt-1 break-words text-sm font-medium">{title}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`merge-search-${meetingId}`}>
                Find a meeting
              </Label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-3.5 left-3 size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  autoFocus
                  id={`merge-search-${meetingId}`}
                  className="min-h-11 pl-9"
                  type="search"
                  placeholder="Search meetings"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelected(null);
                  }}
                  disabled={busy}
                />
              </div>
            </div>
            <div aria-busy={loading} className="min-h-28">
              {loading ? (
                <p
                  className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
                  role="status"
                >
                  <Loader2 className="size-4 animate-spin" />
                  Loading meetings
                </p>
              ) : candidates.length ? (
                <fieldset className="space-y-2" disabled={busy}>
                  <legend className="sr-only">Choose a meeting to merge</legend>
                  {candidates.map((meeting) => (
                    <label
                      key={meeting.id}
                      className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 ${selected?.id === meeting.id ? "border-primary/45 bg-primary/5" : "border-border hover:bg-muted/40"}`}
                    >
                      <input
                        className="mt-1 size-4 shrink-0 accent-primary"
                        type="radio"
                        name={`merge-candidate-${meetingId}`}
                        value={meeting.id}
                        checked={selected?.id === meeting.id}
                        onChange={() => setSelected(meeting)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium leading-5">
                          {meeting.title}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {formatDate(meeting.startedAt)} ·{" "}
                          {statusLabel(meeting.status)}
                        </span>
                      </span>
                      {selected?.id === meeting.id ? (
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-primary"
                        />
                      ) : null}
                    </label>
                  ))}
                </fieldset>
              ) : !error ? (
                <p className="py-7 text-center text-sm leading-6 text-muted-foreground">
                  {query
                    ? "No matching meetings."
                    : "No meetings available to merge."}
                </p>
              ) : null}
            </div>
            {selected ? (
              <p className="text-sm leading-6 text-muted-foreground">
                Recordings appear in time order. Transcripts appear as each part
                becomes ready.
              </p>
            ) : null}
            <p className="text-xs leading-5 text-muted-foreground">
              Only meetings you can manage with matching sharing access are
              shown. Original recordings are kept.
            </p>
            {merged.length ? (
              <details className="border-t pt-3">
                <summary className="cursor-pointer text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                  Merged recordings ({merged.length})
                </summary>
                <ul className="mt-2 divide-y">
                  {merged.map((meeting) => (
                    <li
                      key={meeting.id}
                      className="flex items-center gap-3 py-2"
                    >
                      <a
                        href={`/meetings/${encodeURIComponent(meeting.id)}`}
                        className="min-w-0 flex-1 break-words text-sm underline-offset-4 hover:underline"
                      >
                        {meeting.title}
                      </a>
                      <Button
                        className="min-h-11 shrink-0"
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void changeMerge(meeting, "DELETE")}
                      >
                        Undo merge
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {error ? (
              <div role="alert" className="text-sm leading-6 text-destructive">
                {error}
                {!busy ? (
                  <Button
                    className="ml-1 min-h-11"
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    Reload meetings
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col-reverse gap-2 border-t bg-background px-5 py-4 sm:flex-row sm:justify-end">
            <Button
              className="min-h-11"
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              className="min-h-11"
              type="button"
              disabled={busy || loading || !selected}
              onClick={() => {
                if (selected) void changeMerge(selected, "POST");
              }}
            >
              {busy ? (
                <>
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  Updating meetings
                </>
              ) : (
                "Merge meetings"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "Ready",
    processing: "Transcript processing",
    recording: "Recording",
    joining: "Bot joining",
    waiting_room: "In waiting room",
    scheduled: "Scheduled",
    failed: "Needs attention",
    missed: "No recording",
  };
  return labels[status.toLowerCase()] ?? status;
}

function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
