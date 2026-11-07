"use client";

import { useState } from "react";

import { AppLabel } from "@/components/app-label";
import { formatDuration } from "@/lib/person-format";

export type ActivityMonth = { key: string; label: string; short: string; count: number; ms: number };

/**
 * Time spent with the person per month over the last year. One series, so no
 * legend: the heading names it. Bars grow from the baseline; hovering or
 * focusing a month shows its meetings and hours. A table carries the same
 * numbers for screen readers.
 */
export function PersonActivity({ months }: { months: ActivityMonth[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...months.map(month => month.ms), 1);
  const focus = active === null ? null : months[active];

  return (
    <figure className="mt-5 max-w-[52ch]">
      <div aria-hidden="true" className="flex h-6 items-end" onMouseLeave={() => setActive(null)}>
        {months.map((month, index) => {
          const height = month.ms > 0 ? Math.round(5 + (month.ms / max) * 19) : month.count ? 5 : 0;
          return (
            <div
              className="flex h-full flex-1 cursor-default items-end justify-center"
              key={month.key}
              onMouseEnter={() => setActive(index)}
            >
              {height ? (
                <div
                  className={`w-2 rounded-sm transition-[background-color] duration-150 ease-out ${active === index ? "bg-foreground/70" : "bg-foreground/30"}`}
                  style={{ height }}
                />
              ) : (
                <div className="mb-px size-1 rounded-full bg-muted-foreground/40" />
              )}
            </div>
          );
        })}
      </div>
      <p aria-live="polite" className="mt-2 flex h-4 items-center justify-between gap-4 text-xs tabular-nums text-muted-foreground">
        <AppLabel as="span">{months[0].short}</AppLabel>
        {focus ? <span className="text-foreground/80">{focus.label} · {focus.count} {focus.count === 1 ? "meeting" : "meetings"} · {formatDuration(focus.ms)}</span> : null}
        <AppLabel as="span">Now</AppLabel>
      </p>
      <table className="sr-only">
        <caption>Meetings and time together by month, last 12 months</caption>
        <thead><tr><th>Month</th><th>Meetings</th><th>Time</th></tr></thead>
        <tbody>
          {months.map(month => (
            <tr key={month.key}><td>{month.label}</td><td>{month.count}</td><td>{formatDuration(month.ms)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
