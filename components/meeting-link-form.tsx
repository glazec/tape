"use client";

import { FormEvent, useRef, useState } from "react";
import { AlertCircle, CalendarPlus, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type FormState = "idle" | "saving" | "scheduled" | "joining" | "error";
type RecoveryCandidate = {
  id: string;
  startedAt: string;
  title: string;
};

export function MeetingLinkForm() {
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [pendingMeetingUrl, setPendingMeetingUrl] = useState("");
  const [recoveryCandidate, setRecoveryCandidate] =
    useState<RecoveryCandidate | null>(null);
  const recoveryReturnFocusRef = useRef<HTMLElement | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const meetingUrl = String(formData.get("meeting-link") ?? "").trim();

    if (!meetingUrl) {
      setState("error");
      setMessage("Enter a Google Meet or Zoom link");
      return;
    }

    await scheduleMeeting(meetingUrl);
  }

  async function scheduleMeeting(
    meetingUrl: string,
    choice: { createSeparateMeeting?: boolean; recoveryMeetingId?: string } = {},
  ) {
    setState("saving");
    setMessage(null);
    setSignInRequired(false);
    setRecoveryCandidate(null);

    try {
      const response = await fetch("/api/meetings/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingUrl, ...choice }),
      });

      if (response.status === 401) {
        setState("error");
        setMessage("Sign in to schedule a meeting bot");
        setSignInRequired(true);
        return;
      }

      const responseBody = (await response.json().catch(() => null)) as {
        code?: unknown;
        error?: unknown;
        recoveryMeeting?: unknown;
        status?: unknown;
      } | null;

      const candidate = parseRecoveryCandidate(responseBody?.recoveryMeeting);

      if (
        response.status === 409 &&
        responseBody?.code === "meeting_recovery_available" &&
        candidate
      ) {
        recoveryReturnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setPendingMeetingUrl(meetingUrl);
        setRecoveryCandidate(candidate);
        setState("idle");
        return;
      }

      if (!response.ok) {
        if (
          typeof responseBody?.error === "string" &&
          responseBody.error.toLowerCase().includes("join")
        ) {
          setState("error");
          setMessage("Bot could not join. Try again.");
          return;
        }

        throw new Error("Meeting bot request failed");
      }

      if (responseBody?.status === "joining") {
        setState("joining");
        setMessage("The bot should appear within about 30 seconds.");
      } else {
        setState("scheduled");
        setMessage("Meeting bot scheduled");
      }
    } catch {
      setState("error");
      setMessage("Meeting bot could not be scheduled");
    }
  }

  return (
    <Card>
      <CardHeader className="border-b bg-muted/35">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Meeting link</CardTitle>
            <CardDescription>
              Tape joins an active meeting now or schedules a future meeting.
            </CardDescription>
          </div>
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <CalendarPlus className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="meeting-link">Meeting link</Label>
            <Input
              id="meeting-link"
              name="meeting-link"
              type="url"
              placeholder="https://meet.google.com/example"
              className="min-h-11 bg-background"
              aria-invalid={state === "error"}
            />
          </div>
          <Button
            type="submit"
            disabled={state === "saving"}
            className="min-h-11 w-fit"
          >
            <CalendarPlus data-icon="inline-start" />
            {state === "saving" ? "Checking meeting" : "Add meeting bot"}
          </Button>
          {message ? (
            <Alert
              role={state === "error" ? "alert" : "status"}
              variant={state === "error" ? "destructive" : "default"}
            >
              {state === "error" ? <AlertCircle /> : <CheckCircle2 />}
              <AlertTitle>
                {state === "error"
                  ? message?.startsWith("Bot could not join")
                    ? "Bot could not join"
                    : "Meeting not scheduled"
                  : state === "joining"
                    ? "Bot joining"
                    : "Bot scheduled"}
              </AlertTitle>
              <AlertDescription>
                {message}
                {signInRequired ? (
                  <>
                    {" "}
                    <a href="/auth/sign-in">Sign in</a>
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setRecoveryCandidate(null);
          }
        }}
        open={Boolean(recoveryCandidate)}
      >
        {recoveryCandidate ? (
          <DialogContent finalFocus={recoveryReturnFocusRef}>
            <DialogTitle>
              Send bot to {recoveryCandidate.title}?
            </DialogTitle>
            <DialogDescription className="mt-2">
              Started {formatRecoveryStart(recoveryCandidate.startedAt)}. This
              meeting has no usable notes. Keep the next call under the same
              meeting record?
            </DialogDescription>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                onClick={() =>
                  void scheduleMeeting(pendingMeetingUrl, {
                    recoveryMeetingId: recoveryCandidate.id,
                  })
                }
                type="button"
              >
                Send bot to this meeting
              </Button>
              <Button
                onClick={() =>
                  void scheduleMeeting(pendingMeetingUrl, {
                    createSeparateMeeting: true,
                  })
                }
                type="button"
                variant="outline"
              >
                Create separate meeting
              </Button>
              <DialogClose
                className={buttonVariants({ variant: "ghost" })}
                type="button"
              >
                Cancel
              </DialogClose>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

function formatRecoveryStart(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "recently"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function parseRecoveryCandidate(value: unknown): RecoveryCandidate | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  return typeof candidate.id === "string" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.title === "string"
    ? {
        id: candidate.id,
        startedAt: candidate.startedAt,
        title: candidate.title,
      }
    : null;
}
