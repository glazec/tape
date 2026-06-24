"use client";

import { FormEvent, useState } from "react";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ShareDialogProps = {
  meetingId: string;
};

type ShareState = "idle" | "sharing" | "success" | "error";

export function ShareDialog({ meetingId }: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<ShareState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const encodedMeetingId = encodeURIComponent(meetingId);

  async function shareMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sharing");
    setMessage(null);

    const response = await fetch(`/api/meetings/${encodedMeetingId}/share`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      setState("error");
      setMessage(body?.error ?? "Could not share this meeting.");
      return;
    }

    setState("success");
    setEmail("");
    setMessage("Added to teammate dashboard.");
  }

  return (
    <Card aria-labelledby="share-dialog-title">
      <CardHeader>
        <CardTitle id="share-dialog-title">Share</CardTitle>
        <CardDescription>Team members only.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-3" onSubmit={shareMeeting}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="share-email">Coworker email</Label>
            <Input
              autoComplete="email"
              id="share-email"
              name="email"
              onChange={(event) => {
                setEmail(event.currentTarget.value);
                setState("idle");
                setMessage(null);
              }}
              placeholder="teammate@example.com"
              required
              type="email"
              value={email}
            />
          </div>
          <Button
            className="w-fit"
            disabled={state === "sharing"}
            type="submit"
          >
            <Send data-icon="inline-start" />
            {state === "sharing" ? "Sharing" : "Share"}
          </Button>
          {message ? (
            <Alert variant={state === "error" ? "destructive" : "default"}>
              {state === "error" ? <AlertCircle /> : <CheckCircle2 />}
              <AlertTitle>
                {state === "error" ? "Share failed" : "Shared"}
              </AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
      <CardFooter>
        <p className="min-w-0 break-all text-xs text-muted-foreground">
          Meeting ID: {meetingId}
        </p>
      </CardFooter>
    </Card>
  );
}
