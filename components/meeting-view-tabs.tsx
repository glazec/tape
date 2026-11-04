"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AudioLines, Sparkles } from "lucide-react";

import { NOTE_MOMENT_NAVIGATE } from "@/lib/note-moments";
import { cn } from "@/lib/utils";

export type MeetingView = "notes" | "transcript";

const views: Array<{ id: MeetingView; label: string; icon: typeof Sparkles }> = [
  { id: "notes", label: "Notes", icon: Sparkles },
  { id: "transcript", label: "Transcript", icon: AudioLines },
];

// The inactive panel stays laid out (so textareas still measure) but invisible
// and out of the tab order; the fixed player bar opts back in at any depth.
const INACTIVE_PANEL = "invisible h-0 overflow-hidden [&_[data-persistent-player]]:visible";

function elementForHash(hash: string) {
  if (hash.length < 2) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

/**
 * Granola style switch between the notes and the transcript. Both panels stay
 * mounted so note timestamps, source links and the audio player keep working.
 */
export function MeetingViewTabs({
  initialView = "notes",
  notes,
  transcript,
}: {
  initialView?: MeetingView;
  notes: ReactNode;
  transcript: ReactNode;
}) {
  const [view, setView] = useState<MeetingView>(initialView);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<MeetingView, HTMLButtonElement>());
  const id = useId();

  function select(next: MeetingView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "notes") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  }

  // Anything that points into the transcript opens it first, synchronously,
  // so the browser or the transcript can scroll to the target.
  useEffect(() => {
    const targetsTranscript = (hash: string) => {
      const target = elementForHash(hash);
      return Boolean(target && transcriptRef.current?.contains(target));
    };
    const openTranscript = () => flushSync(() => setView("transcript"));
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href^='#']");
      if (anchor && targetsTranscript(anchor.getAttribute("href") ?? "")) openTranscript();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(NOTE_MOMENT_NAVIGATE, openTranscript, true);
    const initialHash = setTimeout(() => {
      if (targetsTranscript(window.location.hash)) {
        openTranscript();
        elementForHash(window.location.hash)?.scrollIntoView();
      }
    }, 0);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(NOTE_MOMENT_NAVIGATE, openTranscript, true);
      clearTimeout(initialHash);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = views[(views.findIndex(item => item.id === view) + 1) % views.length].id;
    select(next);
    tabRefs.current.get(next)?.focus();
  }

  // Only the visible notes panel clears the fixed player: padding on the
  // hidden one would still hold open a gap above the transcript.
  return (
    <div className="[&:has(audio)_[data-view-panel=notes][data-state=active]]:pb-40">
      <div
        aria-label="Meeting view"
        className="mb-8 inline-flex items-center gap-0.5 rounded-full bg-muted/60 p-1"
        role="tablist"
      >
        {views.map(({ id: viewId, label, icon: Icon }) => {
          const selected = view === viewId;
          return (
            <button
              aria-controls={`${id}-${viewId}`}
              aria-selected={selected}
              className={cn(
                "inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:h-8",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              id={`${id}-${viewId}-tab`}
              key={viewId}
              onClick={() => select(viewId)}
              onKeyDown={onKeyDown}
              ref={(node) => {
                if (node) tabRefs.current.set(viewId, node);
                else tabRefs.current.delete(viewId);
              }}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </button>
          );
        })}
      </div>
      <div
        aria-labelledby={`${id}-notes-tab`}
        className={view === "notes" ? undefined : INACTIVE_PANEL}
        data-state={view === "notes" ? "active" : "inactive"}
        data-view-panel="notes"
        id={`${id}-notes`}
        role="tabpanel"
      >
        {notes}
      </div>
      <div
        aria-labelledby={`${id}-transcript-tab`}
        className={view === "transcript" ? undefined : INACTIVE_PANEL}
        data-state={view === "transcript" ? "active" : "inactive"}
        data-view-panel="transcript"
        id={`${id}-transcript`}
        ref={transcriptRef}
        role="tabpanel"
      >
        {transcript}
      </div>
    </div>
  );
}
