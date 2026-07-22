"use client";

import { useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";

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
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <Badge>{status}</Badge>
      <span>{platform}</span>
      {durationLabel ? <MetadataPart>{durationLabel}</MetadataPart> : null}
      {dateLabel ? <MetadataPart>{dateLabel}</MetadataPart> : null}
    </div>
  );
}

function MetadataPart({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span aria-hidden="true" className="text-border">
        •
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

  const totalMinutes = Math.max(1, Math.round(resolvedDurationMs / 60_000));
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
