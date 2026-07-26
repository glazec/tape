"use client";

/**
 * Interface mockups drawn in HTML rather than pasted in as screenshots.
 *
 * A 1440px application capture scaled into a 640px column is unreadable, and
 * the raster captures also carry stale branding and blur patches over real
 * customer names. These render crisp at any size, follow the live brand tokens,
 * and can show exactly the one idea each section is arguing.
 *
 * Content is illustrative. Keep it generic: no real customer names, no quotes
 * attributed to real people.
 */

import { Check, ChevronDown, Languages, Play } from "lucide-react";

import { cn } from "@/lib/utils";

function Chrome({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-ink/10 bg-paper shadow-[0_28px_64px_-32px_oklch(0.19_0.007_30/0.26)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4 border-b border-ink/8 bg-mist/60 px-5 py-3.5">
        <p className="truncate text-[0.8125rem] font-medium text-ink">
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

const LINES = [
  {
    speaker: "Lin",
    tone: "bg-brand",
    at: "04:12",
    source: "我们下周把数据管道切到新的调度器。",
    translation: "We move the data pipeline onto the new scheduler next week.",
  },
  {
    speaker: "Marco",
    tone: "bg-graphite",
    at: "04:26",
    source: "回滚方案要先写好，别到时候手忙脚乱。",
    translation:
      "Write the rollback plan first, so nobody is scrambling on the day.",
  },
  {
    speaker: "Lin",
    tone: "bg-brand",
    at: "04:41",
    source: "预算那块我下午发你一份明细。",
    translation: "I will send you a breakdown of the budget this afternoon.",
  },
];

export function BilingualTranscriptMockup() {
  return (
    <Chrome
      title="Platform planning · 41 min"
      action={
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/12 bg-paper px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-graphite">
          <Languages aria-hidden className="size-3" />
          中文 → EN
        </span>
      }
    >
      <ul className="divide-y divide-ink/8">
        {LINES.map((line) => (
          <li key={line.at} className="px-5 py-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", line.tone)}
              />
              <span className="text-[0.75rem] font-medium text-ink">
                {line.speaker}
              </span>
              <span className="font-mono text-[0.6875rem] tabular-nums text-ash">
                {line.at}
              </span>
            </div>
            <p className="mt-2 text-[0.875rem] leading-[1.7] text-ink">
              {line.source}
            </p>
            <p className="mt-1 flex gap-2 text-[0.875rem] leading-[1.7] text-graphite">
              <span
                aria-hidden
                className="mt-[0.3rem] h-3.5 w-px shrink-0 bg-brand/45"
              />
              {line.translation}
            </p>
          </li>
        ))}
      </ul>
    </Chrome>
  );
}

const SERIES = [
  {
    title: "Weekly partner sync",
    count: "14 in series",
    children: [
      { when: "Jul 16", length: "48m", entities: ["Scheduler", "$40k"] },
      { when: "Jul 09", length: "52m", entities: ["Scheduler", "Rollback"] },
      { when: "Jul 02", length: "45m", entities: ["Pricing"] },
    ],
  },
  {
    title: "Design review",
    count: "6 in series",
    children: [
      { when: "Jul 14", length: "31m", entities: ["Onboarding"] },
      { when: "Jul 07", length: "28m", entities: ["Onboarding", "Mobile"] },
    ],
  },
];

export function MeetingSeriesMockup() {
  return (
    <Chrome
      title="Meeting library"
      action={
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink/12 bg-paper px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-graphite">
          Grouped
          <ChevronDown aria-hidden className="size-3" />
        </span>
      }
    >
      <div className="divide-y divide-ink/8">
        {SERIES.map((series) => (
          <div key={series.title} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ChevronDown aria-hidden className="size-3.5 text-graphite" />
              <p className="text-[0.875rem] font-medium text-ink">
                {series.title}
              </p>
              <span className="rounded-full bg-brand/12 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-brand-ink">
                {series.count}
              </span>
              <span className="ml-auto font-mono text-[0.625rem] uppercase tracking-[0.1em] text-ash">
                Context carried
              </span>
            </div>
            <ul className="mt-3 ml-[1.4rem] flex flex-col gap-2.5 border-l border-ink/10 pl-4">
              {series.children.map((child) => (
                <li
                  key={child.when}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
                >
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-mist text-graphite">
                    <Play aria-hidden className="size-2.5" />
                  </span>
                  <span className="font-mono text-[0.6875rem] tabular-nums text-graphite">
                    {child.when}
                  </span>
                  <span className="font-mono text-[0.6875rem] tabular-nums text-ash">
                    {child.length}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {child.entities.map((entity) => (
                      <span
                        key={entity}
                        className="rounded border border-ink/10 px-1.5 py-px font-mono text-[0.625rem] text-graphite"
                      >
                        {entity}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-4">
          <ChevronDown
            aria-hidden
            className="size-3.5 -rotate-90 text-graphite"
          />
          <p className="text-[0.875rem] font-medium text-ink">
            Investor update
          </p>
          <span className="rounded-full bg-mist px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-graphite">
            9 in series
          </span>
        </div>
      </div>
    </Chrome>
  );
}

/** Dark variant, for the enterprise section. */
export function ShareSeriesMockup() {
  return (
    <div className="overflow-hidden rounded-xl border border-paper/15 bg-paper/[0.04] p-5 sm:p-6">
      <p className="font-mono text-label uppercase tracking-[0.16em] text-paper/55">
        Share
      </p>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-paper/15 bg-ink px-3.5 py-2.5">
        <span className="truncate text-[0.875rem] text-paper/85">
          colleague@yourteam.com
        </span>
        <span className="shrink-0 rounded-full bg-paper/10 px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-paper/60">
          Reader
        </span>
      </div>
      <label className="mt-3.5 flex items-start gap-3">
        <span
          aria-hidden
          className="mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-[0.25rem] bg-brand text-paper"
        >
          <Check aria-hidden className="size-3" strokeWidth={3} />
        </span>
        <span className="text-[0.875rem] leading-[1.6] text-paper/85">
          Include past and future related meetings
        </span>
      </label>
      <p className="mt-4 border-t border-paper/12 pt-4 text-[0.8125rem] leading-[1.65] text-paper/60">
        Every future meeting in this series reaches them on its own. They never
        have to ask what they missed.
      </p>
    </div>
  );
}
