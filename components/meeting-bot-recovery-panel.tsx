"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, Link2 } from "lucide-react";

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

type RecoveryState = "idle" | "joining" | "complete" | "error";

export function MeetingBotRecoveryPanel({
  meetingId,
  meetingUrl,
}: {
  meetingId: string;
  meetingUrl: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<RecoveryState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [showReplacementLink, setShowReplacementLink] = useState(!meetingUrl);

  async function requestBot(nextMeetingUrl: string) {
    if (!nextMeetingUrl.trim()) {
      setState("error");
      setMessage("Enter a Google Meet or Zoom link");
      return;
    }

    setState("joining");
    setMessage(null);

    try {
      const response = await fetch("/api/meetings/link", {
        body: JSON.stringify({
          meetingUrl: nextMeetingUrl.trim(),
          recoveryMeetingId: meetingId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "Bot could not join");
      }

      setState("complete");
      setMessage("The bot is joining this meeting again.");
      router.refresh();
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Bot could not join",
      );
    }
  }

  function submitNewLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void requestBot(String(formData.get("new-meeting-link") ?? ""));
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b bg-muted/35">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Continue this meeting</CardTitle>
            <CardDescription>
              Tape did not capture a usable record. Send the bot back to keep
              the next call under this meeting.
            </CardDescription>
          </div>
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot aria-hidden="true" className="size-4" />
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {state !== "complete" ? (
          <>
            {meetingUrl ? (
              <Button
                disabled={state === "joining"}
                onClick={() => void requestBot(meetingUrl)}
                size="sm"
                type="button"
              >
                <Bot data-icon="inline-start" />
                Ask bot to rejoin
              </Button>
            ) : null}

            {showReplacementLink ? (
              <form className="space-y-3" onSubmit={submitNewLink}>
                <div className="space-y-2">
                  <Label htmlFor="new-meeting-link">New meeting link</Label>
                  <Input
                    disabled={state === "joining"}
                    id="new-meeting-link"
                    name="new-meeting-link"
                    placeholder="https://meet.google.com/example"
                    type="url"
                  />
                </div>
                <Button
                  disabled={state === "joining"}
                  size="sm"
                  type="submit"
                  variant="outline"
                >
                  <Link2 data-icon="inline-start" />
                  Send bot to new link
                </Button>
              </form>
            ) : (
              <Button
                disabled={state === "joining"}
                onClick={() => setShowReplacementLink(true)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Use a different link
              </Button>
            )}
          </>
        ) : null}

        {message ? (
          <Alert role={state === "error" ? "alert" : "status"} variant={state === "error" ? "destructive" : "default"}>
            {state === "complete" ? <CheckCircle2 /> : null}
            <AlertTitle>{state === "error" ? "Bot could not join" : "Bot joining"}</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
