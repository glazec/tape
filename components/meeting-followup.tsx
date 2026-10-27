"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui/react/popover";
import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MeetingFollowup as Followup } from "@/lib/meeting-followup";

export function MeetingFollowup({
  canGenerate,
  initialResult,
  meetingId,
  sourceHash,
  segments,
}: {
  canGenerate: boolean;
  initialResult: Followup | null;
  meetingId: string;
  sourceHash: string;
  segments: Array<{ id: string; startMs: number }>;
}) {
  const [result, setResult] = useState(initialResult);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const pending = useRef<AbortController | null>(null);
  const headingId = useId();
  const router = useRouter();
  useEffect(() => () => pending.current?.abort(), []);

  if (!canGenerate && !result) return null;

  async function generate() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setAnnouncement("Generating followup.");
    try {
      const response = await fetch(
        `/api/meetings/${encodeURIComponent(meetingId)}/followup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceHash }),
          signal: controller.signal,
        },
      );
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (
          response.status === 401 ||
          response.status === 404 ||
          response.status === 409
        ) {
          setResult(null);
          router.refresh();
        }
        throw new Error(
          data.error || "Could not generate the followup. Please try again.",
        );
      }
      setResult(data.result);
      setAnnouncement("Followup ready.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not generate the followup. Please try again.",
      );
      setAnnouncement("");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      pending.current = null;
    }
  }

  function renderItems(items: Followup["dynamics"] | Followup["todos"]) {
    return (
      <ul className="space-y-4">
        {items.map((item, index) => (
          <li className="min-w-0 text-sm leading-6" key={index}>
            <p className="max-w-[52ch] break-words text-pretty">
              <span className="font-semibold">@{item.person}</span>
              {item.text.slice(item.person.length)}
            </p>
            {"timing" in item &&
            typeof item.timing === "string" &&
            item.timing ? (
              <p className="mt-1 max-w-[60ch] text-xs leading-5 text-muted-foreground">
                {item.timing}
              </p>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-x-1">
              <span className="mr-1 text-xs text-muted-foreground">Source</span>
              {item.evidence.map((evidence, evidenceIndex) => {
                const segment = segments.find(
                  (segment) => segment.id === evidence.segmentId,
                );
                if (!segment) return null;
                const seconds = Math.floor(segment.startMs / 1000);
                const timestamp = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
                return (
                  <Popover.Root key={evidenceIndex}>
                    <Popover.Trigger
                      aria-label={`View source at ${timestamp}`}
                      className="group/source inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md text-xs tabular-nums text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      openOnHover
                      delay={150}
                      closeDelay={150}
                    >
                      <span className="px-2 py-1 underline decoration-muted-foreground/40 underline-offset-4 group-hover/source:decoration-foreground">
                        {timestamp}
                      </span>
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner
                        side="top"
                        align="start"
                        sideOffset={6}
                        collisionPadding={16}
                        className="z-50"
                      >
                        <Popover.Popup className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none">
                          <Popover.Title className="text-xs font-medium text-muted-foreground">
                            Transcript · {timestamp}
                          </Popover.Title>
                          <Popover.Description className="mt-2 max-h-60 overflow-y-auto break-words text-sm leading-6">
                            “{evidence.quote}”
                          </Popover.Description>
                          <Popover.Close
                            render={<a href={`#${evidence.segmentId}`} />}
                            nativeButton={false}
                            role="link"
                            className="mt-1 inline-flex min-h-11 items-center rounded-sm text-xs font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            View in transcript
                          </Popover.Close>
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const generateButton = canGenerate ? (
    <Button
      className={
        result && !error
          ? "min-h-11 min-w-11 text-muted-foreground hover:text-foreground"
          : "min-h-11 gap-2"
      }
      title={result && !error ? "Regenerate followup" : undefined}
      disabled={busy}
      onClick={generate}
      size={result && !error ? "icon-sm" : "sm"}
      variant={error ? "outline" : result ? "ghost" : "default"}
    >
      {busy ? (
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
      ) : result && !error ? (
        <RefreshCw aria-hidden="true" className="size-3.5" />
      ) : null}
      <span className={result && !error ? "sr-only" : undefined}>
        {busy
          ? "Generating followup…"
          : error
            ? "Retry"
            : result
              ? "Regenerate"
              : "Generate followup"}
      </span>
    </Button>
  ) : null;

  return (
    <details className="group/followup mb-10 border-y" open={Boolean(result)}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-3 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium">AI followup</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/followup:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <section
        aria-labelledby={headingId}
        className="pb-5 pt-1"
        aria-busy={busy}
      >
        <h2 className="sr-only" id={headingId}>
          AI followup
        </h2>
        {result ? (
          <>
            <div className="space-y-5">
              <div>
                <h3 className="mb-2 text-sm font-semibold">To do list</h3>
                {result.todos.length ? (
                  renderItems(result.todos)
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    No explicit next actions.
                  </p>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Dynamic</h3>
                {result.dynamics.length ? (
                  renderItems(result.dynamics)
                ) : (
                  <p className="text-sm leading-6 text-muted-foreground">
                    No explicit offers or needs.
                  </p>
                )}
              </div>
            </div>
            {!error && canGenerate ? (
              <div className="mt-2 flex justify-end">{generateButton}</div>
            ) : null}
          </>
        ) : (
          <div className="space-y-4 pb-1">
            <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">
              Find next actions and what people offer or need.
            </p>
            {!error ? generateButton : null}
          </div>
        )}
        {error ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <p className="min-w-0 flex-1 text-sm leading-6 text-destructive" role="alert">
              {error}
            </p>
            {generateButton}
          </div>
        ) : null}
      </section>
    </details>
  );
}
