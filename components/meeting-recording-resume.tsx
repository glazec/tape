"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function MeetingRecordingResume({
  meetingId,
  meetingUrl,
  lastRecordingEndedAt,
}: {
  meetingId: string;
  meetingUrl: string;
  lastRecordingEndedAt: string;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const expiresAt = Date.parse(lastRecordingEndedAt) + 60 * 60 * 1000;
  const [expiredDeadline, setExpiredDeadline] = useState<number | null>(() =>
    Date.now() >= expiresAt ? expiresAt : null,
  );
  const expired = !Number.isFinite(expiresAt) || expiredDeadline === expiresAt;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(meetingUrl);
  const [state, setState] = useState<"idle" | "joining" | "joined">("idle");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    const remaining = expiresAt - Date.now();
    const timer = window.setTimeout(
      () => setExpiredDeadline(expiresAt),
      Math.max(0, remaining),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  async function continueRecording(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (Date.now() >= expiresAt) {
      setExpiredDeadline(expiresAt);
      return;
    }
    submitting.current = true;
    setState("joining");
    setError(null);
    try {
      const response = await fetch(
        `/api/meetings/${encodeURIComponent(meetingId)}/continue`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ meetingUrl: url.trim() }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // A conflict or provider error can still leave a claimed recording.
        // Refresh its state without clearing the draft or the inline error.
        if (response.status === 409 || response.status === 502)
          router.refresh();
        if (Date.now() >= expiresAt || body?.code === "continuation_expired")
          setExpiredDeadline(expiresAt);
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "The bot could not join. Check the link and try again.",
        );
      }
      setState("joined");
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setState("idle");
      setError(
        cause instanceof Error
          ? cause.message
          : "The bot could not join. Try again.",
      );
    } finally {
      submitting.current = false;
    }
  }

  if (expired && !open && state !== "joined") return null;

  return (
    <>
      {!expired || state === "joined" ? (
        <div className="mb-5 flex flex-col gap-3 rounded-lg border bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {state === "joined" ? "Bot joining" : "Recording stopped"}
            </p>
            <p
              className="mt-1 text-sm leading-6 text-muted-foreground"
              role={state === "joined" ? "status" : undefined}
            >
              {state === "joined"
                ? "The next recording will appear here once the bot joins."
                : "Add the next recording to this meeting within one hour of its end."}
            </p>
          </div>
          {state !== "joined" ? (
            <Button
              className="min-h-11 shrink-0"
              ref={triggerRef}
              onClick={() => setOpen(true)}
              type="button"
            >
              Continue recording
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : null}
        </div>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (state !== "joining") setOpen(nextOpen);
        }}
      >
        <DialogContent
          finalFocus={triggerRef}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          <DialogTitle>Continue recording</DialogTitle>
          <DialogDescription className="mt-2">
            The same recording bot will join. Your earlier recording stays here.
          </DialogDescription>
          <form className="mt-5 space-y-5" onSubmit={continueRecording}>
            <div className="space-y-2">
              <Label htmlFor={`continue-link-${meetingId}`}>Meeting link</Label>
              <Input
                id={`continue-link-${meetingId}`}
                autoFocus
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Paste a Zoom or Google Meet link"
                className="min-h-11"
                disabled={state === "joining" || expired}
                aria-invalid={Boolean(error)}
                aria-describedby={
                  error || expired ? `continue-error-${meetingId}` : undefined
                }
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Use the previous link or paste the new one.
              </p>
            </div>
            {expired || error ? (
              <p
                id={`continue-error-${meetingId}`}
                className="text-sm leading-6 text-destructive"
                role="alert"
              >
                {expired
                  ? "The one hour window has ended. Add a new meeting to keep recording."
                  : error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                className="min-h-11"
                type="button"
                variant="ghost"
                disabled={state === "joining"}
                onClick={() => setOpen(false)}
              >
                {expired ? "Close" : "Cancel"}
              </Button>
              {!expired ? (
                <Button
                  className="min-h-11"
                  disabled={state === "joining" || !url.trim()}
                  type="submit"
                >
                  {state === "joining" ? (
                    <>
                      <Loader2
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                      Requesting bot
                    </>
                  ) : (
                    "Join and continue"
                  )}
                </Button>
              ) : null}
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
