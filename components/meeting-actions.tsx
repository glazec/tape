"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MeetingActionsProps = {
  meetingId: string;
};

export function MeetingActions({ meetingId }: MeetingActionsProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const encodedMeetingId = encodeURIComponent(meetingId);

  async function deleteMeeting() {
    if (!window.confirm("Delete this meeting?")) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    const response = await fetch(`/api/meetings/${encodedMeetingId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      setIsDeleting(false);
      setError("Could not delete this meeting.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <a
        className={cn(buttonVariants({ variant: "outline" }))}
        href={`/api/meetings/${encodedMeetingId}/export`}
      >
        <Download data-icon="inline-start" />
        Export
      </a>
      <Button
        disabled={isDeleting}
        onClick={deleteMeeting}
        type="button"
        variant="destructive"
      >
        <Trash2 data-icon="inline-start" />
        {isDeleting ? "Deleting" : "Delete"}
      </Button>
      {error ? (
        <p className="basis-full text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
