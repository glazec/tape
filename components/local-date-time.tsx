"use client";

import { useSyncExternalStore } from "react";

type LocalDateTimeProps = {
  /** Day only, for lists where the time of day does not matter. */
  dateOnly?: boolean;
  /** Time only, for rows that already sit under a day heading. */
  timeOnly?: boolean;
  value: string;
};

export function LocalDateTime({ dateOnly = false, timeOnly = false, value }: LocalDateTimeProps) {
  const label = useSyncExternalStore(
    subscribeToLocalTime,
    () => dateOnly ? formatLocalDate(value) : formatLocalDateTime(value, timeOnly),
    getServerSnapshot,
  );

  return <time dateTime={value}>{label || " "}</time>;
}

function subscribeToLocalTime() {
  return () => {};
}

function getServerSnapshot() {
  return "";
}

function formatLocalDateTime(value: string, timeOnly = false) {
  return new Intl.DateTimeFormat("en", {
    ...(timeOnly ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLocalDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}
