"use client";

import { useSyncExternalStore } from "react";

type LocalDateTimeProps = {
  /** Time only, for rows that already sit under a day heading. */
  timeOnly?: boolean;
  value: string;
};

export function LocalDateTime({ timeOnly = false, value }: LocalDateTimeProps) {
  const label = useSyncExternalStore(
    subscribeToLocalTime,
    () => formatLocalDateTime(value, timeOnly),
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
