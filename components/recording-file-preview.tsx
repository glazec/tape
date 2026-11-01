"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Headphones } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMediaTimestamp } from "@/lib/recording-file-time";

function timestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : minutes}:${String(total % 60).padStart(2, "0")}`;
}

export function RecordingFilePreview({
  file,
  onDuration,
}: {
  file: File;
  onDuration?: (durationMs: number) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [jump, setJump] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  const jumpId = useId();
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const objectUrl = URL.createObjectURL(file);
    // Object URLs are external browser resources; publish only after acquisition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(objectUrl);
    const element = media.current;
    return () => {
      element?.pause();
      element?.removeAttribute("src");
      element?.load();
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  function seek() {
    const seconds = parseMediaTimestamp(jump);
    if (seconds === null) {
      setError("Use a time such as 12:34 or 1:02:34.");
      return;
    }
    if (!duration || seconds > duration) {
      setError("Choose a time within this recording.");
      return;
    }
    if (media.current) {
      media.current.currentTime = seconds;
      setElapsed(seconds);
      setError(null);
    }
  }
  const mediaProps = {
    "aria-label": "Recording preview",
    controls: true,
    preload: "metadata" as const,
    src: url ?? undefined,
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      const value = event.currentTarget.duration;
      if (Number.isFinite(value) && value > 0) {
        setDuration(value);
        onDuration?.(Math.round(value * 1000));
      }
    },
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) =>
      setElapsed(event.currentTarget.currentTime),
    onError: () => setUnplayable(true),
  };
  return (
    <section
      aria-label="Preview recording"
      className="space-y-3 rounded-xl bg-muted/35 p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <Headphones
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium leading-5">
            {file.name}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {(file.size / 1024 / 1024).toFixed(1)} MB · Preview stays on this
            device
          </p>
        </div>
      </div>
      {file.type.startsWith("video/") || /\.(mp4|mov|mkv)$/i.test(file.name) ? (
        <video
          {...mediaProps}
          ref={(node) => {
            media.current = node;
          }}
          className="max-h-64 w-full rounded-lg"
        />
      ) : (
        <audio
          {...mediaProps}
          ref={(node) => {
            media.current = node;
          }}
          className="h-11 w-full"
        />
      )}
      {unplayable ? (
        <p className="text-sm text-muted-foreground" role="status">
          This browser cannot preview this recording. You can still upload it
          for transcription.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={jumpId} className="text-xs text-muted-foreground">
              Jump to time
            </Label>
            <Input
              id={jumpId}
              className="h-11 w-28 bg-background tabular-nums"
              placeholder="12:34"
              value={jump}
              onChange={(event) => {
                setJump(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  seek();
                }
              }}
              aria-invalid={!!error}
              aria-describedby={error ? `${jumpId}-error` : undefined}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!duration}
            onClick={seek}
          >
            Jump
          </Button>
          <span
            className="ml-auto pb-3 text-xs tabular-nums text-muted-foreground"
            aria-label="Preview position"
          >
            {timestamp(elapsed)} / {duration ? timestamp(duration) : "Loading…"}
          </span>
        </div>
      )}
      {error ? (
        <p
          id={`${jumpId}-error`}
          className="text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
