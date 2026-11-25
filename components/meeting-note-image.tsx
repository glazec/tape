"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NoteImage } from "@/lib/meeting-note-document";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useRef, useState } from "react";

const clampWidth = (width: number) => Math.min(100, Math.max(25, Math.round(width)));

export function MeetingNoteImage({
  blockId,
  image,
  src,
  uploadStatus,
  onRetry,
  onResize,
  onMeasure,
  onRemove,
}: {
  blockId: string;
  image: NoteImage;
  src: string;
  uploadStatus?: string;
  onRetry?: () => void;
  onResize?: (width: number) => void;
  onMeasure?: (ratio: number) => void;
  onRemove?: () => void;
}) {
  const figure = useRef<HTMLElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; availableWidth: number; initial: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string>();
  return (
    <figure ref={figure} className="group my-3">
      <div ref={frame} style={{ width: `${image.width}%` }} className="relative">
        <Dialog onOpenChange={(open) => { if (!open) setActualSize(false); }}>
          <DialogPrimitive.Trigger
            id={`note-image-${blockId}`}
            type="button"
            aria-label="Enlarge note image"
            style={{ aspectRatio: image.aspectRatio }}
            className="block w-full cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-ring"
            onKeyDown={(event) => {
              if (onRemove && (event.key === "Backspace" || event.key === "Delete")) {
                event.preventDefault();
                onRemove();
              }
            }}
          >
            {/* The source is an authenticated route. Load it directly in the browser. */}
            {failedSrc === src ? (
              <span className="block rounded-md bg-muted p-4 text-sm">Image unavailable</span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="Pasted note image" draggable={false} onError={() => setFailedSrc(src)}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (!image.aspectRatio && naturalWidth && naturalHeight) {
                    onMeasure?.(naturalWidth / naturalHeight);
                  }
                }}
                className="block h-auto w-full rounded-md" />
            )}
          </DialogPrimitive.Trigger>
          <DialogContent className="max-w-[min(96vw,90rem)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <DialogTitle>Note image</DialogTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" aria-pressed={actualSize} onClick={() => setActualSize(!actualSize)}>
                  {actualSize ? "Fit to view" : "Actual size"}
                </Button>
                <a
                  href={src}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded px-2 py-1 text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Open original
                </a>
                <DialogClose render={<Button size="sm" variant="ghost" />}>
                  Close
                </DialogClose>
              </div>
            </div>
            <div
              tabIndex={0}
              role="region"
              aria-label="Image viewport"
              className="max-h-[78dvh] overflow-auto focus-visible:outline-2 focus-visible:outline-ring"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="Pasted note image" className={actualSize ? "h-auto max-w-none" : "mx-auto h-auto max-h-[72dvh] max-w-full"} />
            </div>
          </DialogContent>
        </Dialog>
        {onResize ? (
          <div
            role="slider"
            tabIndex={0}
            aria-label="Image width"
            aria-valuemin={25}
            aria-valuemax={100}
            aria-valuenow={image.width}
            aria-valuetext={`${image.width}%`}
            aria-orientation="horizontal"
            title="Drag to resize"
            className={`absolute right-0 top-0 flex h-full max-h-24 w-11 touch-none cursor-ew-resize items-center justify-end px-1 focus-visible:outline-2 focus-visible:outline-ring ${dragging ? "opacity-100" : "pointer-fine:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
            onPointerDown={(event) => {
              const availableWidth = figure.current?.getBoundingClientRect().width;
              if (event.button !== 0 || !availableWidth || drag.current) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { pointerId: event.pointerId, x: event.clientX, availableWidth, initial: image.width, width: image.width };
              setDragging(true);
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (!active || active.pointerId !== event.pointerId || !frame.current) return;
              active.width = clampWidth(active.initial + (event.clientX - active.x) / active.availableWidth * 100);
              frame.current.style.width = `${active.width}%`;
            }}
            onPointerUp={(event) => {
              const active = drag.current;
              if (!active || active.pointerId !== event.pointerId) return;
              drag.current = null;
              setDragging(false);
              if (active.width !== image.width) onResize(active.width);
            }}
            onLostPointerCapture={() => {
              if (!drag.current) return;
              drag.current = null;
              if (frame.current) frame.current.style.width = `${image.width}%`;
              setDragging(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && drag.current) {
                event.preventDefault();
                event.currentTarget.releasePointerCapture(drag.current.pointerId);
                return;
              }
              const increments: Record<string, number> = {
                ArrowRight: image.width + 5,
                ArrowUp: image.width + 5,
                ArrowLeft: image.width - 5,
                ArrowDown: image.width - 5,
                Home: 25,
                End: 100,
              };
              const width = increments[event.key];
              if (typeof width !== "number") return;
              event.preventDefault();
              onResize(clampWidth(width));
            }}
          >
            <span aria-hidden="true" className="h-10 w-1.5 rounded-full border border-white/80 bg-black/65 shadow-sm" />
          </div>
        ) : null}
      </div>
      {uploadStatus ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span role={onRetry ? "alert" : "status"}>{uploadStatus}</span>
          {onRetry ? <Button size="sm" variant="ghost" onClick={onRetry}>Retry upload</Button> : null}
        </div>
      ) : null}
      {onResize ? (
        <div className="mt-1 flex justify-end pointer-fine:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
          <Button size="sm" variant="ghost" onClick={onRemove}>Remove image</Button>
        </div>
      ) : null}
    </figure>
  );
}
