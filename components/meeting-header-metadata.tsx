"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

type MeetingHeaderMetadataProps = {
  durationMs: number | null;
  endedAt: string | null;
  platform: string;
  startedAt: string | null;
  status: string;
};

export function MeetingHeaderMetadata({
  durationMs,
  endedAt,
  platform,
  startedAt,
  status,
}: MeetingHeaderMetadataProps) {
  const dateLabel = useSyncExternalStore(
    subscribeToLocalTime,
    () => (startedAt ? formatMeetingHeaderDateTime(startedAt) : ""),
    getServerSnapshot,
  );
  const durationLabel = formatMeetingHeaderDuration({
    durationMs,
    endedAt,
    startedAt,
    status,
  });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground tabular-nums">
      <span className="inline-flex items-center gap-1.5 text-foreground">
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", getStatusDotClassName(status))}
        />
        {status}
      </span>
      <MetadataPart>{platform}</MetadataPart>
      {durationLabel ? <MetadataPart>{durationLabel}</MetadataPart> : null}
      {dateLabel ? <MetadataPart>{dateLabel}</MetadataPart> : null}
    </div>
  );
}

function getStatusDotClassName(status: string) {
  switch (status) {
    case "Ready":
    case "Completed":
      return "bg-emerald-500";
    case "Recording":
      return "bg-rose-500";
    case "Failed":
      return "bg-destructive";
    case "In waiting room":
    case "Processing":
    case "Queued":
    case "Transcribing":
      return "bg-amber-500";
    default:
      return "bg-muted-foreground/50";
  }
}

function MetadataPart({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden="true" className="text-muted-foreground/50">
        ·
      </span>
      <span>{children}</span>
    </span>
  );
}

function subscribeToLocalTime() {
  return () => {};
}

function getServerSnapshot() {
  return "";
}

export function formatMeetingHeaderDateTime(
  value: string,
  now = new Date(),
) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const timeLabel = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  if (isSameLocalDay(date, now)) {
    return `Today, ${timeLabel}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameLocalDay(date, yesterday)) {
    return `Yesterday, ${timeLabel}`;
  }

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  }).format(date);

  return `${dateLabel}, ${timeLabel}`;
}

export function formatMeetingHeaderDuration({
  durationMs,
  endedAt,
  startedAt,
  status,
  now = new Date(),
}: {
  durationMs: number | null;
  endedAt: string | null;
  startedAt: string | null;
  status?: string;
  now?: Date;
}) {
  let resolvedDurationMs = durationMs;

  if (
    (!resolvedDurationMs || resolvedDurationMs <= 0) &&
    status === "Scheduled" &&
    startedAt &&
    new Date(startedAt).getTime() > now.getTime() &&
    endedAt
  ) {
    const startTime = new Date(startedAt).getTime();
    const endTime = new Date(endedAt).getTime();
    const intervalMs = endTime - startTime;

    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      resolvedDurationMs = intervalMs;
    }
  }

  if (!resolvedDurationMs || resolvedDurationMs <= 0) {
    return null;
  }

  const totalMinutes = Math.max(1, Math.floor(resolvedDurationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours && minutes) {
    return `${hours}h ${minutes}m`;
  }

  if (hours) {
    return `${hours}h`;
  }

  return totalMinutes === 1 ? "1 minute" : `${totalMinutes} minutes`;
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
