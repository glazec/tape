"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type MeetingActionsProps = {
  hasTranslations?: boolean;
  meetingId: string;
  instanceId?: string;
};

type ExportFormat = "transcript" | "mp3";
type TranscriptLanguage = "zh" | "original";

export function MeetingActions({
  hasTranslations = false,
  meetingId,
  instanceId = "default",
}: MeetingActionsProps) {
  const router = useRouter();
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [selectedExportFormats, setSelectedExportFormats] = useState<
    Record<ExportFormat, boolean>
  >({
    mp3: true,
    transcript: true,
  });
  const [selectedTranscriptLanguage, setSelectedTranscriptLanguage] =
    useState<TranscriptLanguage>(hasTranslations ? "zh" : "original");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
  const [error, setError] = useState<string | null>(null);
  const encodedMeetingId = encodeURIComponent(meetingId);
  const exportMenuId = `meeting-export-menu-${instanceId}-${meetingId}`;
  const textExportUrl = `/api/meetings/${encodedMeetingId}/export?format=text`;
  const selectedTextExportUrl = `${textExportUrl}&language=${selectedTranscriptLanguage}`;
  const mp3ExportUrl = `/api/meetings/${encodedMeetingId}/export?format=mp3`;
  const hasSelectedExport =
    selectedExportFormats.transcript || selectedExportFormats.mp3;

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
      selectedExportFormats.transcript ? selectedTextExportUrl : null,
      selectedExportFormats.mp3 ? mp3ExportUrl : null,
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
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
            <input
              checked={selectedExportFormats.transcript}
              className="size-4 rounded border-input accent-primary"
              onChange={() => toggleExportFormat("transcript")}
              type="checkbox"
            />
            <span className="font-medium">Transcript</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
            <input
              checked={selectedExportFormats.mp3}
              className="size-4 rounded border-input accent-primary"
              onChange={() => toggleExportFormat("mp3")}
              type="checkbox"
            />
            <span className="font-medium">MP3</span>
          </label>
          {hasTranslations ? (
            <fieldset className="mt-2 border-t pt-2">
              <legend className="px-2 text-xs font-medium text-muted-foreground">
                Transcript language
              </legend>
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
                <input
                  checked={selectedTranscriptLanguage === "zh"}
                  className="size-4 border-input accent-primary"
                  name={`${exportMenuId}-language`}
                  onChange={() => setSelectedTranscriptLanguage("zh")}
                  type="radio"
                />
                <span className="font-medium">中文</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
                <input
                  checked={selectedTranscriptLanguage === "original"}
                  className="size-4 border-input accent-primary"
                  name={`${exportMenuId}-language`}
                  onChange={() => setSelectedTranscriptLanguage("original")}
                  type="radio"
                />
                <span className="font-medium">Original</span>
              </label>
            </fieldset>
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
