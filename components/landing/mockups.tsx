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

import { Check, Languages, Play } from "lucide-react";

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
        "overflow-hidden rounded-xl border border-ink/10 bg-paper",
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
    at: "04:12",
    source: "我们下周把数据管道切到新的调度器。",
    translation: "We move the data pipeline onto the new scheduler next week.",
  },
  {
    speaker: "Marco",
    misheard: "Marko",
    at: "04:26",
    source: "回滚方案要先写好，别到时候手忙脚乱。",
    translation:
      "Write the rollback plan first, so nobody is scrambling on the day.",
    playing: true,
  },
  {
    speaker: "Lin",
    at: "04:41",
    source: "预算那块我下午发你一份明细。",
    translation: "I will send you a breakdown of the budget this afternoon.",
  },
];

/** Original and translation as two aligned columns, one row per line. */
export function SideBySideTranscriptMockup() {
  return (
    <Chrome
      title="Platform planning · 41 min"
      action={
        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-graphite">
          <Languages aria-hidden className="size-3.5" />
          中文 · English
        </span>
      }
    >
      <ul className="flex flex-col sm:hidden">
        {LINES.map((line) => (
          <li
            key={line.at}
            className={cn("px-5 py-4", line.playing && "bg-brand/[0.05]")}
          >
            <p className="flex items-baseline gap-2 text-[0.8125rem] font-medium text-ink">
              {line.speaker}
              <span className="font-mono text-[0.6875rem] font-normal tabular-nums text-ash">
                {line.at}
              </span>
            </p>
            <p className="mt-1.5 text-[0.9375rem] leading-[1.6] text-ink">
              {line.source}
            </p>
            <p className="mt-1 text-[0.875rem] leading-[1.6] text-graphite">
              {line.translation}
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink/8 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ash">
              <th className="w-[9.5rem] px-5 py-2.5 font-normal">Speaker</th>
              <th className="px-5 py-2.5 font-normal">Original</th>
              <th className="px-5 py-2.5 font-normal">Translation</th>
            </tr>
          </thead>
          <tbody>
            {LINES.map((line) => (
              <tr
                key={line.at}
                className={cn(
                  "border-b border-ink/8 align-top last:border-0",
                  line.playing && "bg-brand/[0.05]",
                )}
              >
                <td className="px-5 py-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[0.8125rem] font-medium text-ink">
                      {line.misheard ? (
                        <>
                          <s className="mr-1.5 font-normal text-ash decoration-brand-ink/60">
                            {line.misheard}
                          </s>
                          {line.speaker}
                        </>
                      ) : (
                        line.speaker
                      )}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 font-mono text-[0.6875rem] tabular-nums text-ash">
                    {line.playing ? (
                      <Play
                        aria-hidden
                        className="size-2.5 fill-brand-ink text-brand-ink"
                      />
                    ) : null}
                    {line.at}
                  </p>
                </td>
                <td className="px-5 py-4 text-[0.9375rem] leading-[1.65] text-ink">
                  {line.source}
                </td>
                <td className="px-5 py-4 text-[0.9375rem] leading-[1.65] text-graphite">
                  {line.translation}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Chrome>
  );
}

const LEVELS = [
  3, 5, 8, 6, 11, 14, 9, 12, 16, 10, 7, 13, 15, 9, 6, 10, 12, 8, 5, 4,
];

/**
 * The macOS menu bar recorder, redrawn: only the parts a reader needs to see,
 * with none of the account and maintenance controls the real window carries.
 */
export function RecorderMockup() {
  return (
    <div className="mx-auto w-full max-w-[22rem] overflow-hidden rounded-xl border border-ink/10 bg-paper">
      <div className="flex items-center gap-1.5 border-b border-ink/8 bg-mist/60 px-4 py-3">
        <span aria-hidden className="size-2.5 rounded-full bg-ink/15" />
        <span aria-hidden className="size-2.5 rounded-full bg-ink/15" />
        <span aria-hidden className="size-2.5 rounded-full bg-ink/15" />
        <p className="ml-2 text-[0.75rem] font-medium text-graphite">Tape</p>
      </div>
      <div className="px-5 pt-5">
        <p className="text-[0.75rem] text-ash">In this room · started 11:02</p>
        <p className="mt-1 text-[0.9375rem] font-medium text-ink">
          Platform planning
        </p>
      </div>
      <div className="mx-5 mt-5 rounded-lg border border-ink/10 px-4 py-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[0.8125rem] font-medium text-ink">
            <span aria-hidden className="size-2 rounded-full bg-brand" />
            Recording
          </span>
          <span className="font-mono text-[0.75rem] tabular-nums text-graphite">
            12:48
          </span>
        </div>
        <div aria-hidden className="mt-4 flex h-5 items-center gap-[3px]">
          {LEVELS.map((level, index) => (
            <span
              key={index}
              className="w-[3px] rounded-full bg-ink/70"
              style={{ height: `${level + 4}px` }}
            />
          ))}
        </div>
      </div>
      <ul className="mt-4 divide-y divide-ink/8 border-t border-ink/8 text-[0.8125rem]">
        {[
          ["Microphone", "MacBook Pro"],
          ["System audio", "Zoom, Chrome"],
        ].map(([label, value]) => (
          <li
            key={label}
            className="flex items-center justify-between px-5 py-3"
          >
            <span className="text-graphite">{label}</span>
            <span className="inline-flex items-center gap-1.5 text-ink">
              <Check aria-hidden className="size-3.5 text-brand-ink" />
              {value}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-ink/8 px-5 py-4">
        <span className="flex h-10 w-full items-center justify-center rounded-full bg-ink text-[0.8125rem] font-medium text-paper">
          Stop and upload
        </span>
      </div>
    </div>
  );
}

const AGENDA = [
  { at: "09:30", title: "Founder intro call", via: "Zoom", state: "Joined" },
  {
    at: "11:00",
    title: "Weekly partner sync",
    via: "Google Meet",
    state: "Joining",
  },
  {
    at: "14:00",
    title: "Portfolio review",
    via: "Teams",
    state: "Record on Mac",
  },
];

/**
 * A day from the calendar as Tape sees it: the bot takes the Zoom and Meet
 * calls, and anything it cannot attend is handed to the Mac recorder.
 */
export function CalendarJoinMockup() {
  return (
    <Chrome
      title="Today"
      className="w-full max-w-[26rem]"
      action={
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ash">
          Calendar connected
        </span>
      }
    >
      <ul className="flex flex-col gap-1 p-2.5">
        {AGENDA.map((item) => (
          <li
            key={item.title}
            className="flex items-center gap-4 rounded-lg px-3 py-3 odd:bg-mist/50"
          >
            <span className="w-11 shrink-0 font-mono text-[0.75rem] tabular-nums text-graphite">
              {item.at}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] font-medium text-ink">
                {item.title}
              </span>
              <span className="block text-[0.75rem] text-ash">{item.via}</span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium",
                item.state === "Joining"
                  ? "bg-brand/12 text-brand-ink"
                  : "bg-mist text-graphite",
              )}
            >
              {item.state}
            </span>
          </li>
        ))}
      </ul>
    </Chrome>
  );
}

const ANSWERS = [
  {
    speaker: "Marco",
    title: "Weekly partner sync",
    when: "Oct 14",
    at: "18:52",
  },
  { speaker: "Lin", title: "产品路线图评审", when: "Sep 09", at: "27:41" },
  {
    speaker: "Priya",
    title: "Pipeline migration sync",
    when: "Aug 21",
    at: "08:15",
  },
];

/**
 * An outside assistant asking Tape a question over MCP, in English, and
 * getting cited moments back from meetings held in either language.
 */
export function AgentQueryMockup() {
  return (
    <div className="w-full max-w-[34rem] overflow-hidden rounded-xl bg-paper">
      <div className="flex items-center gap-1.5 bg-mist/70 px-4 py-3">
        <span aria-hidden className="size-2.5 rounded-full bg-ink/15" />
        <span aria-hidden className="size-2.5 rounded-full bg-ink/15" />
        <span aria-hidden className="size-2.5 rounded-full bg-ink/15" />
        <p className="ml-2 text-[0.75rem] font-medium text-graphite">
          Your assistant
        </p>
      </div>
      <div className="px-6 py-6 sm:px-7">
        <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[0.875rem] leading-6 text-paper">
          Who has offered us an intro to a payments team since August?
        </p>
        <p className="mt-6 inline-flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ash">
          <span aria-hidden className="size-1.5 rounded-full bg-brand" />
          tape.execute_meeting_sql · 3 rows from 41 meetings
        </p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {ANSWERS.map((answer) => (
            <li
              key={answer.title}
              className="flex items-baseline justify-between gap-4 rounded-lg bg-mist/60 px-3.5 py-2.5 text-[0.8125rem]"
            >
              <span className="min-w-0 truncate text-ink">
                <span className="hidden sm:inline">{answer.speaker} · </span>
                {answer.title}
              </span>
              <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-graphite">
                {answer.when} · {answer.at}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[0.875rem] leading-6 text-pretty text-graphite">
          Three people offered. Lin made the warmest one, in Mandarin, at 27:41
          of the roadmap review: she worked with their head of partnerships.
        </p>
      </div>
    </div>
  );
}

const FOLLOWUP = {
  todo: [
    { owner: "Lin", task: "Send Marco the budget breakdown", at: "04:41" },
    {
      owner: "Marco",
      task: "Write the rollback plan before cutover",
      at: "04:26",
    },
  ],
  dynamic: [
    {
      kind: "Offers",
      text: "Marco can lend two engineers for the cutover week",
      at: "12:08",
    },
    {
      kind: "Needs",
      text: "Lin needs a second reviewer on the scheduler change",
      at: "13:30",
    },
  ],
  connection: {
    speaker: "Marco",
    relation: "Worked with",
    who: "Priya, who ran the last scheduler migration at a logistics firm",
    at: "18:52",
  },
  research:
    "What does a one week slip in the migration cost the Q3 reporting deadline?",
};

function FollowupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ash">
      {children}
    </p>
  );
}

function At({ at }: { at: string }) {
  return (
    <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-brand-ink">
      {at}
    </span>
  );
}

/**
 * The follow-up Tape writes after a call, redrawn with the four parts the
 * product generates: to-dos, the dynamic, connections, and open questions.
 * Every item carries the moment it was said, as the real panel does.
 */
export function FollowupMockup() {
  return (
    <Chrome
      title="Pipeline migration sync · Follow-up"
      action={
        <span className="shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-graphite">
          Linked to transcript
        </span>
      }
    >
      <div className="grid gap-x-8 gap-y-6 px-5 py-5 [&>*]:min-w-0 sm:grid-cols-2 sm:px-6 sm:py-6">
        <div className="order-3">
          <FollowupHeading>To do</FollowupHeading>
          <ul className="mt-3 flex flex-col gap-2.5">
            {FOLLOWUP.todo.map((item) => (
              <li
                key={item.task}
                className="flex items-start gap-2.5 text-[0.8125rem] leading-5"
              >
                <span
                  aria-hidden
                  className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[0.3rem] bg-mist"
                />
                <span className="min-w-0 flex-1 text-ink">
                  <span className="font-medium">{item.owner}</span> ·{" "}
                  {item.task}
                </span>
                <At at={item.at} />
              </li>
            ))}
          </ul>
        </div>
        <div className="order-2">
          <FollowupHeading>Room dynamic</FollowupHeading>
          <ul className="mt-3 flex flex-col gap-2.5">
            {FOLLOWUP.dynamic.map((item) => (
              <li
                key={item.text}
                className="flex items-start gap-2.5 text-[0.8125rem] leading-5"
              >
                <span className="mt-px shrink-0 rounded-full bg-mist px-2 py-px font-mono text-[0.5625rem] uppercase leading-4 tracking-[0.1em] text-graphite">
                  {item.kind}
                </span>
                <span className="min-w-0 flex-1 text-ink">{item.text}</span>
                <At at={item.at} />
              </li>
            ))}
          </ul>
        </div>
        <div className="order-1">
          <FollowupHeading>Potential connections</FollowupHeading>
          <div className="mt-3 rounded-lg bg-mist/70 px-3.5 py-3 text-[0.8125rem] leading-5">
            <p className="flex items-center gap-2 text-graphite">
              <span className="font-medium text-ink">
                {FOLLOWUP.connection.speaker}
              </span>
              <span className="rounded-full bg-brand/12 px-2 py-px font-mono text-[0.5625rem] uppercase leading-4 tracking-[0.1em] text-brand-ink">
                {FOLLOWUP.connection.relation}
              </span>
              <span className="ml-auto">
                <At at={FOLLOWUP.connection.at} />
              </span>
            </p>
            <p className="mt-1.5 text-ink">{FOLLOWUP.connection.who}</p>
          </div>
        </div>
        <div className="order-4">
          <FollowupHeading>Potential research</FollowupHeading>
          <p className="mt-3 text-[0.8125rem] leading-5 text-pretty text-ink">
            {FOLLOWUP.research}
          </p>
          <span className="mt-3 inline-flex h-8 items-center gap-2 rounded-full bg-ink px-3.5 text-[0.75rem] font-medium text-paper">
            <Check aria-hidden className="size-3.5" />
            Copied as a research prompt
          </span>
        </div>
      </div>
    </Chrome>
  );
}
