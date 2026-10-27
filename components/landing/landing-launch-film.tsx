"use client";

import { useRef } from "react";
import { Play, X } from "lucide-react";

/**
 * The launch film opens in a dialog from the hero rather than sitting on the
 * page as its own section: its title card has a look of its own, and a visitor
 * who wants it is one click away.
 */
export function LaunchFilmButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const open = () => {
    dialogRef.current?.showModal();
    void videoRef.current?.play().catch(() => undefined);
  };

  const close = () => {
    videoRef.current?.pause();
    dialogRef.current?.close();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="group inline-flex items-center gap-3 rounded-full text-[0.9375rem] text-graphite transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
      >
        <span className="flex size-9 items-center justify-center rounded-full border border-ink/15 transition-colors group-hover:border-ink/40">
          <Play aria-hidden className="ml-0.5 size-3.5 fill-current" />
        </span>
        Watch the film
        <span className="font-mono text-[0.75rem] tabular-nums text-ash">
          0:30
        </span>
      </button>
      <dialog
        ref={dialogRef}
        aria-label="Launch film"
        onClose={() => videoRef.current?.pause()}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        className="m-auto w-[min(64rem,calc(100vw-2rem))] max-w-none overflow-visible bg-transparent p-0 backdrop:bg-ink/80 backdrop:backdrop-blur-sm"
      >
        <div className="relative overflow-hidden rounded-xl bg-ink">
          <video
            ref={videoRef}
            aria-label="Tape product launch film"
            className="aspect-video w-full"
            controls
            playsInline
            poster="/media/tape-launch-v4-poster.jpg"
            preload="none"
          >
            <source src="/media/tape-launch-v4.mp4" type="video/mp4" />
            <track
              default
              kind="captions"
              label="English"
              src="/media/tape-launch-v4-en.vtt"
              srcLang="en"
            />
          </video>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close film"
          className="absolute -top-12 right-0 flex size-9 items-center justify-center rounded-full text-paper/80 transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X aria-hidden className="size-5" />
        </button>
      </dialog>
    </>
  );
}
