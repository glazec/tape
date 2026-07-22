"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  MoreHorizontal,
  Trash2,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

type MeetingActionsProps = {
  hasAudio?: boolean;
  hasTranscript?: boolean;
  meetingId: string;
  imageCount?: number;
  instanceId?: string;
};

type ExportFormat = "transcript" | "mp3" | "images";

export function MeetingActions({
  hasAudio = true,
  hasTranscript = true,
  meetingId,
  imageCount = 0,
  instanceId = "default",
}: MeetingActionsProps) {
  const router = useRouter();
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [selectedExportFormats, setSelectedExportFormats] = useState<
    Record<ExportFormat, boolean>
  >({
    images: imageCount > 0,
    mp3: hasAudio,
    transcript: hasTranscript,
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const encodedMeetingId = encodeURIComponent(meetingId);
  const exportMenuId = `meeting-export-menu-${instanceId}-${meetingId}`;
  const textExportUrl = `/api/meetings/${encodedMeetingId}/export?format=text`;
  const mp3ExportUrl = `/api/meetings/${encodedMeetingId}/export?format=mp3`;
  const imagesExportUrl = `/api/meetings/${encodedMeetingId}/export?format=images`;
  const includeImages = imageCount > 0 && selectedExportFormats.images;
  const hasSelectedExport =
    (hasTranscript && selectedExportFormats.transcript) ||
    (hasAudio && selectedExportFormats.mp3) ||
    includeImages;
  const hasExportableContent = hasAudio || hasTranscript || imageCount > 0;

  useEffect(() => {
    if (!isExportMenuOpen) {
      return;
    }

    function closeOnOutsideClick(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !exportMenuRef.current?.contains(event.target)
      ) {
        setIsExportMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isExportMenuOpen]);

  function downloadFile(url: string) {
    const link = document.createElement("a");
    link.href = url;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }

  function toggleExportFormat(format: ExportFormat) {
    setSelectedExportFormats((current) => ({
      ...current,
      [format]: !current[format],
    }));
  }

  function exportSelected() {
    if (!hasSelectedExport) {
      return;
    }

    const urls = [
      hasTranscript && selectedExportFormats.transcript ? textExportUrl : null,
      hasAudio && selectedExportFormats.mp3 ? mp3ExportUrl : null,
      includeImages ? imagesExportUrl : null,
    ].filter((url): url is string => Boolean(url));

    urls.forEach((url, index) => {
      window.setTimeout(() => downloadFile(url), index * 100);
    });
    setIsExportMenuOpen(false);
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
      {hasExportableContent ? (
        <div className="relative" ref={exportMenuRef}>
          <Button
            aria-controls={isExportMenuOpen ? exportMenuId : undefined}
            aria-expanded={isExportMenuOpen}
            aria-haspopup="menu"
            onClick={() => setIsExportMenuOpen((current) => !current)}
            type="button"
            variant="outline"
          >
            <Download data-icon="inline-start" />
            Export
            <ChevronDown data-icon="inline-end" />
          </Button>
          <div
            aria-label="Export options"
            className="absolute right-0 z-20 mt-2 w-56 rounded-lg border bg-popover p-2 text-sm text-popover-foreground shadow-lg"
            hidden={!isExportMenuOpen}
            id={exportMenuId}
            role="menu"
          >
            {hasTranscript ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
                <input
                  checked={selectedExportFormats.transcript}
                  className="size-4 rounded border-input accent-primary"
                  onChange={() => toggleExportFormat("transcript")}
                  type="checkbox"
                />
                <span className="font-medium">Transcript</span>
              </label>
            ) : null}
            {hasAudio ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
                <input
                  checked={selectedExportFormats.mp3}
                  className="size-4 rounded border-input accent-primary"
                  onChange={() => toggleExportFormat("mp3")}
                  type="checkbox"
                />
                <span className="font-medium">MP3</span>
              </label>
            ) : null}
            {imageCount > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
                <input
                  checked={selectedExportFormats.images}
                  className="size-4 rounded border-input accent-primary"
                  onChange={() => toggleExportFormat("images")}
                  type="checkbox"
                />
                <span className="font-medium">Images ({imageCount})</span>
              </label>
            ) : null}
            <Button
              className="mt-2 w-full"
              disabled={!hasSelectedExport}
              onClick={exportSelected}
              type="button"
            >
              <Download data-icon="inline-start" />
              Download selected
            </Button>
          </div>
        </div>
      ) : null}
      {hasTranscript ? (
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
      ) : null}
      <details className="group relative">
        <summary
          aria-label="More meeting actions"
          className={`${buttonVariants({ size: "icon", variant: "ghost" })} min-h-11 min-w-11 list-none text-muted-foreground`}
        >
          <MoreHorizontal />
          <span className="sr-only">More meeting actions</span>
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-44 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-lg">
          <Button
            className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isDeleting}
            onClick={deleteMeeting}
            type="button"
            variant="ghost"
          >
            <Trash2 data-icon="inline-start" />
            {isDeleting ? "Deleting" : "Delete meeting"}
          </Button>
        </div>
      </details>
      {error ? (
        <p className="basis-full text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
