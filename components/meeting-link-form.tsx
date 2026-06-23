"use client";

import { FormEvent, useState } from "react";
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

type FormState = "idle" | "saving" | "scheduled" | "error";

export function MeetingLinkForm() {
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    setMessage(null);

    const formData = new FormData(event.currentTarget);
    const meetingUrl = String(formData.get("meeting-link") ?? "").trim();

    if (!meetingUrl) {
      setState("error");
      setMessage("Enter a Google Meet or Zoom link");
      return;
    }

    try {
      const response = await fetch("/api/meetings/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ meetingUrl }),
      });

      if (!response.ok) {
        throw new Error("Meeting bot request failed");
      }

      setState("scheduled");
      setMessage("Meeting bot scheduled");
    } catch {
      setState("error");
      setMessage("Meeting bot could not be scheduled");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting link</CardTitle>
        <CardDescription>
          Schedule a bot for a Google Meet or Zoom call.
        </CardDescription>
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
              aria-invalid={state === "error"}
            />
          </div>
          <Button type="submit" disabled={state === "saving"} className="w-fit">
            <CalendarPlus data-icon="inline-start" />
            {state === "saving" ? "Scheduling..." : "Save meeting link"}
          </Button>
          {message ? (
            <Alert variant={state === "error" ? "destructive" : "default"}>
              {state === "error" ? <AlertCircle /> : <CheckCircle2 />}
              <AlertTitle>
                {state === "error" ? "Meeting not scheduled" : "Bot scheduled"}
              </AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
