"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, FileText, Music2, Trash2 } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MeetingActionsProps = {
  meetingId: string;
};

export function MeetingActions({ meetingId }: MeetingActionsProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const encodedMeetingId = encodeURIComponent(meetingId);
  const textExportUrl = `/api/meetings/${encodedMeetingId}/export?format=text`;
  const mp3ExportUrl = `/api/meetings/${encodedMeetingId}/export?format=mp3`;

  function downloadFile(url: string) {
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }

  function exportAll() {
    downloadFile(textExportUrl);
    window.setTimeout(() => downloadFile(mp3ExportUrl), 0);
  }

  async function copyTranscript() {
    setIsCopying(true);
    setCopyStatus("idle");
    setError(null);

    try {
      const response = await fetch(textExportUrl);

      if (!response.ok) {
        setError("Could not copy transcript.");
        return;
      }

      await navigator.clipboard.writeText(await response.text());
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 2000);
    } catch {
      setError("Could not copy transcript.");
    } finally {
      setIsCopying(false);
    }
  }

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
        href={textExportUrl}
      >
        <FileText data-icon="inline-start" />
        Export text
      </a>
      <a
        className={cn(buttonVariants({ variant: "outline" }))}
        href={mp3ExportUrl}
      >
        <Music2 data-icon="inline-start" />
        Export MP3
      </a>
      <Button onClick={exportAll} type="button" variant="outline">
        <Download data-icon="inline-start" />
        Export all
      </Button>
      <Button
        disabled={isCopying}
        onClick={copyTranscript}
        type="button"
        variant="outline"
      >
        {copyStatus === "copied" ? (
          <Check data-icon="inline-start" />
        ) : (
          <Copy data-icon="inline-start" />
        )}
        {copyStatus === "copied" ? "Copied" : "Copy"}
      </Button>
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
