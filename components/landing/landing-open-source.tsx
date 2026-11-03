"use client";

import Image from "next/image";
import { ArrowUpRight, Check, GitFork } from "lucide-react";

import {
  formatGithubActivity,
  type GithubActivity,
} from "@/lib/github-activity";
import { REPOSITORY_URL } from "@/lib/site";

import { Container, FadeIn, TrackLabel } from "./landing-section";

/**
 * The two reasons the code is public, each with three things a team can do
 * because of it. Every claim maps to something in the repository today.
 */
const REASONS = [
  {
    label: "Make it yours",
    points: [
      {
        title: "Change what it writes.",
        body: "The prompts behind notes, to-dos, and research live in the repo.",
      },
      {
        title: "Swap the model.",
        body: "Summaries run through OpenRouter, so another model is one setting.",
      },
      {
        title: "Wire in your tools.",
        body: "The MCP server ships in the same repository as the app.",
      },
    ],
  },
  {
    label: "Own your data",
    points: [
      {
        title: "Host the whole stack.",
        body: "Web app, workers, and database on infrastructure you control.",
      },
      {
        title: "Keep the recordings.",
        body: "Audio and transcripts land in your own database and bucket.",
      },
      {
        title: "Hold every key.",
        body: "You choose the transcription and AI providers. Nothing trains a public model.",
      },
    ],
  },
] as const;

/** The real first run, taken from the README, so it works when pasted. */
const TERMINAL = [
  { kind: "cmd", text: "gh repo fork glazec/tape --clone" },
  { kind: "out", text: "✓ Cloned tape into ./tape" },
  { kind: "cmd", text: "cd tape && npm install" },
  { kind: "cmd", text: "cp .env.example .env.local" },
  { kind: "cmd", text: "npm run db:migrate" },
  { kind: "cmd", text: "npm run dev" },
  { kind: "out", text: "▲ Tape ready →", link: "http://localhost:3000" },
  { kind: "cmd", text: "$EDITOR lib/meeting-followup-generation.ts" },
  { kind: "out", text: "# the prompts behind every follow-up" },
] as const;

function Terminal() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.25rem] bg-[oklch(0.15_0.006_30)] ring-1 ring-paper/10">
      <div className="relative flex items-center gap-1.5 px-5 py-4">
        <span aria-hidden className="size-2.5 rounded-full bg-paper/15" />
        <span aria-hidden className="size-2.5 rounded-full bg-paper/15" />
        <span aria-hidden className="size-2.5 rounded-full bg-paper/15" />
        <p className="absolute inset-x-0 text-center font-mono text-[0.75rem] text-paper/45">
          ~/code
        </p>
      </div>
      <pre
        aria-label="Commands to fork and run Tape"
        className="flex-1 overflow-x-auto px-6 pb-8 pt-3 font-mono text-[0.8125rem] leading-[2] sm:text-[0.875rem]"
      >
        {TERMINAL.map((line, index) => (
          <span key={index} className="block whitespace-pre">
            {line.kind === "cmd" ? (
              <>
                <span className="text-brand">$ </span>
                <span className="text-paper">{line.text}</span>
              </>
            ) : (
              <span className="text-paper/45">
                {line.text}
                {"link" in line ? (
                  <span className="text-brand"> {line.link}</span>
                ) : null}
              </span>
            )}
          </span>
        ))}
        <span className="block">
          <span className="text-brand">$ </span>
          <span
            aria-hidden
            className="inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] bg-paper/80 motion-safe:animate-pulse"
          />
        </span>
      </pre>
    </div>
  );
}

export function LandingOpenSource({
  activity,
}: {
  activity: GithubActivity | null;
}) {
  return (
    <section
      id="open-source"
      className="relative isolate scroll-mt-20 overflow-hidden bg-ink text-paper"
    >
      <Image
        src="/media/art/dark-reel.webp"
        alt=""
        fill
        sizes="100vw"
        className="-z-10 scale-[1.15] object-cover object-[85%_50%] opacity-35"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-ink via-ink/80 to-ink"
      />
      <Container className="py-24 lg:py-32">
        <FadeIn className="mx-auto max-w-[46rem] text-center">
          <TrackLabel track="B1" tone="dark" className="justify-center">
            Open source
          </TrackLabel>
          <h2 className="font-display mt-6 text-display-1 tracking-[-0.03em] text-balance">
            Don&rsquo;t like how it works?{" "}
            <em className="italic text-brand">Fork it.</em>
          </h2>
          <p className="mx-auto mt-6 max-w-[48ch] text-[1.0625rem] leading-[1.65] text-pretty text-paper/70">
            The whole codebase is public for two reasons: so you can make Tape
            work the way your team does, and so your meetings never have to
            leave infrastructure you run.
          </p>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-14 grid gap-4 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Terminal />
            <div className="flex flex-col rounded-[1.25rem] bg-paper/[0.06] px-6 py-7 ring-1 ring-paper/10 sm:px-8 sm:py-8">
              <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {REASONS.map((reason) => (
                  <div key={reason.label}>
                    <p className="font-mono text-label uppercase tracking-[0.2em] text-paper/50">
                      {reason.label}
                    </p>
                    <ul className="mt-4 flex flex-col gap-4">
                      {reason.points.map((point) => (
                        <li key={point.title} className="flex gap-3">
                          <Check
                            aria-hidden
                            className="mt-1 size-4 shrink-0 text-brand"
                          />
                          <p className="text-[0.9375rem] leading-[1.55] text-pretty text-paper/65">
                            <span className="font-medium text-paper">
                              {point.title}
                            </span>{" "}
                            {point.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-10">
                <p className="max-w-[46ch] text-[0.9375rem] leading-[1.6] text-pretty text-paper/80">
                  Use it, change it, and host it for your own team, at work too.
                  The one thing you can&rsquo;t do is resell it as a hosted
                  service.
                </p>
                <p className="mt-4 font-mono text-label uppercase leading-[1.8] tracking-[0.16em] text-paper/45">
                  FSL-1.1 · each release becomes Apache 2.0 after two years
                </p>
                {activity ? (
                  <p className="font-mono text-label uppercase leading-[1.8] tracking-[0.16em] text-paper/45">
                    {formatGithubActivity(activity)}
                  </p>
                ) : null}
                <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-4">
                  <a
                    href={`${REPOSITORY_URL}/fork`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 items-center gap-2.5 rounded-full bg-paper px-6 text-[0.875rem] font-medium text-ink transition-colors hover:bg-paper/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 focus-visible:ring-offset-ink"
                  >
                    <GitFork aria-hidden className="size-4" />
                    Fork on GitHub
                  </a>
                  <a
                    href={`${REPOSITORY_URL}/blob/main/docs/setup.md`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-sm text-[0.875rem] text-paper/75 transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    Read the setup guide
                    <ArrowUpRight aria-hidden className="size-4" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
