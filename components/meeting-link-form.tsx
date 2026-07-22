"use client";

import { FormEvent, useRef, useState } from "react";
import { AlertCircle, CalendarPlus, CheckCircle2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

type FormState = "idle" | "saving" | "scheduled" | "joining" | "error";
type MeetingChoice = {
  action: "join" | "schedule";
  endedAt: string | null;
  id: string;
  kind: "calendar" | "recent";
  startedAt: string;
  timing: "current" | "future" | "past";
  title: string;
};

export function MeetingLinkForm() {
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [pendingMeetingUrl, setPendingMeetingUrl] = useState("");
  const [potentialMeetings, setPotentialMeetings] = useState<MeetingChoice[]>(
    [],
  );
  const [pendingChoiceId, setPendingChoiceId] = useState<string | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const choiceReturnFocusRef = useRef<HTMLElement | null>(null);

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
    choice: {
      calendarEventId?: string;
      createSeparateMeeting?: boolean;
      recoveryMeetingId?: string;
    } = {},
  ) {
    const isConfirmingChoice = Object.keys(choice).length > 0;
    setState("saving");
    setMessage(null);
    setSignInRequired(false);
    setChoiceError(null);

    try {
      const response = await fetch("/api/meetings/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingUrl, ...choice }),
      });

      if (response.status === 401) {
        setSignInRequired(true);
        if (isConfirmingChoice) {
          setState("idle");
          setChoiceError("Your session expired. Sign in, then try again.");
        } else {
          setState("error");
          setMessage("Sign in to schedule a meeting bot");
        }
        return;
      }

      const responseBody = (await response.json().catch(() => null)) as {
        code?: unknown;
        error?: unknown;
        potentialMeetings?: unknown;
        status?: unknown;
      } | null;

      const detectedMeetings = parsePotentialMeetings(
        responseBody?.potentialMeetings,
      );

      if (
        response.status === 409 &&
        responseBody?.code === "potential_meetings_detected" &&
        detectedMeetings.length > 0
      ) {
        choiceReturnFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setPendingMeetingUrl(meetingUrl);
        setPotentialMeetings(detectedMeetings);
        setPendingChoiceId(null);
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
          if (isConfirmingChoice) {
            setChoiceError("Bot could not join. Try again.");
            setState("idle");
          }
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
      setPotentialMeetings([]);
      setPendingChoiceId(null);
    } catch {
      if (isConfirmingChoice) {
        setState("idle");
        setChoiceError("Meeting bot could not be scheduled. Try again.");
        setPendingChoiceId(null);
      } else {
        setState("error");
        setMessage("Meeting bot could not be scheduled");
      }
    }
  }

  function mergePotentialMeeting(potentialMeeting: MeetingChoice) {
    setPendingChoiceId(`${potentialMeeting.kind}:${potentialMeeting.id}`);
    void scheduleMeeting(
      pendingMeetingUrl,
      potentialMeeting.kind === "calendar"
        ? { calendarEventId: potentialMeeting.id }
        : { recoveryMeetingId: potentialMeeting.id },
    );
  }

  function keepMeetingSeparate() {
    setPendingChoiceId("new");
    void scheduleMeeting(pendingMeetingUrl, { createSeparateMeeting: true });
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
          if (!open && state !== "saving") {
            setPotentialMeetings([]);
            setPendingChoiceId(null);
            setChoiceError(null);
          }
        }}
        open={potentialMeetings.length > 0}
      >
        {potentialMeetings.length > 0 ? (
          <DialogContent
            className="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col overflow-hidden p-0"
            finalFocus={choiceReturnFocusRef}
          >
            <div className="px-5 pt-5 pb-4">
              <DialogTitle>Which meeting uses this link?</DialogTitle>
              <DialogDescription className="mt-2">
                Choose a nearby meeting to update, or keep this meeting
                separate.
              </DialogDescription>
            </div>

            <div className="min-h-0 space-y-2 overflow-y-auto border-y bg-muted/20 px-5 py-4">
              {potentialMeetings.map((meeting) => {
                const value = `${meeting.kind}:${meeting.id}`;

                return (
                  <button
                    aria-label={`Merge with ${meeting.title}, ${getMeetingTimingLabel(meeting.timing)}`}
                    className="group flex min-h-16 w-full items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-left outline-none transition-colors hover:border-primary/45 hover:bg-primary/5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60"
                    disabled={state === "saving"}
                    key={value}
                    onClick={() => mergePotentialMeeting(meeting)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-muted-foreground">
                        {getMeetingTimingLabel(meeting.timing)}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block font-medium leading-snug">
                        {meeting.title}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground tabular-nums">
                        {formatMeetingTimeRange(meeting)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-primary">
                      {state === "saving" && pendingChoiceId === value
                        ? "Adding bot"
                        : "Use this meeting"}
                    </span>
                  </button>
                );
              })}
            </div>

            {choiceError ? (
              <div className="px-5 pb-4">
                <Alert role="alert" variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Meeting bot unavailable</AlertTitle>
                  <AlertDescription>
                    {choiceError}
                    {signInRequired ? (
                      <>
                        {" "}
                        <a href="/auth/sign-in">Sign in</a>
                      </>
                    ) : null}
                  </AlertDescription>
                </Alert>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
              <Button
                className="min-h-11"
                disabled={state === "saving"}
                onClick={keepMeetingSeparate}
                variant="outline"
                type="button"
              >
                {state === "saving" && pendingChoiceId === "new"
                  ? "Creating meeting"
                  : "Keep separate"}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </Card>
  );
}

function formatMeetingTimeRange(meeting: MeetingChoice) {
  const start = new Date(meeting.startedAt);
  const end = meeting.endedAt ? new Date(meeting.endedAt) : null;

  if (Number.isNaN(start.getTime())) {
    return "Time unavailable";
  }

  const startLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(start);

  if (!end || Number.isNaN(end.getTime())) {
    return startLabel;
  }

  const endLabel = new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
  }).format(end);

  return `${startLabel} to ${endLabel}`;
}

function getMeetingTimingLabel(timing: MeetingChoice["timing"]) {
  return timing === "past"
    ? "Previous"
    : timing === "current"
      ? "Happening now"
      : "Next";
}

function parsePotentialMeetings(value: unknown): MeetingChoice[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as Record<string, unknown>;

    return typeof candidate.id === "string" &&
      (candidate.action === "join" || candidate.action === "schedule") &&
      (candidate.kind === "calendar" || candidate.kind === "recent") &&
      (candidate.endedAt === null || typeof candidate.endedAt === "string") &&
      typeof candidate.startedAt === "string" &&
      (candidate.timing === "current" ||
        candidate.timing === "future" ||
        candidate.timing === "past") &&
      typeof candidate.title === "string"
      ? [candidate as MeetingChoice]
      : [];
  });
}
