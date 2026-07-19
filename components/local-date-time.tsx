"use client";

import { useSyncExternalStore } from "react";

type LocalDateTimeProps = {
  value: string;
};

export function LocalDateTime({ value }: LocalDateTimeProps) {
  const label = useSyncExternalStore(
    subscribeToLocalTime,
    () => formatLocalDateTime(value),
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

function formatLocalDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
