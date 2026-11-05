"use client";

import { type FormEvent, type RefObject, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MeetingLinkReplaceDialogProps = {
  currentMeetingUrl?: string | null;
  finalFocus: RefObject<HTMLElement | null>;
  meetingId: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function MeetingLinkReplaceDialog({
  currentMeetingUrl,
  finalFocus,
  meetingId,
  onOpenChange,
  open,
}: MeetingLinkReplaceDialogProps) {
  const router = useRouter();
  const [meetingUrl, setMeetingUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `meeting-link-${meetingId}`;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/meetings/${encodeURIComponent(meetingId)}/link`,
        {
          body: JSON.stringify({ meetingUrl: meetingUrl.trim() }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        setError(payload?.error ?? "The bot could not be sent to the new link");
        return;
      }

      setMeetingUrl("");
      onOpenChange(false);
      router.refresh();
    } catch {
      setError("The bot could not be sent to the new link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen);
      }}
    >
      <DialogContent finalFocus={finalFocus}>
        <DialogTitle>Change meeting link</DialogTitle>
        <DialogDescription className="mb-4">
          The current bot leaves the old link and a new bot joins this one.
          Calendar updates will no longer change this meeting’s link.
        </DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {currentMeetingUrl ? (
            <p className="break-all text-sm text-muted-foreground">
              Current link: {currentMeetingUrl}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>New Google Meet or Zoom link</Label>
            <Input
              autoComplete="off"
              autoFocus
              disabled={busy}
              id={inputId}
              inputMode="url"
              onChange={(event) => setMeetingUrl(event.target.value)}
              placeholder="https://meet.google.com/abc-defg-hij"
              required
              type="url"
              value={meetingUrl}
            />
          </div>
          {error ? (
            <p className="text-sm font-medium text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              disabled={busy}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={busy || !meetingUrl.trim()} type="submit">
              {busy ? "Sending bot" : "Send bot to new link"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
