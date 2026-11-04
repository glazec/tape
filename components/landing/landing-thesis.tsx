"use client";

import { ArrowUpRight } from "lucide-react";

import { Container, FadeIn } from "./landing-section";

/**
 * The band right after the hero. It states the thesis once, then routes each
 * kind of team to the track written for it, so the page reads as one argument
 * rather than a list of features.
 */
const TEAMS = [
  {
    href: "#languages",
    team: "Bilingual teams",
    line: "Chinese and English in one transcript, translated line by line.",
  },
  {
    href: "#followup",
    team: "AI-native teams",
    line: "Connections, promises, and open questions from every call.",
  },
  {
    href: "#capture",
    team: "Privacy-first teams",
    line: "A Mac app that records the room. No bot on the call.",
  },
  {
    href: "#open-source",
    team: "Engineering teams",
    line: "Open source. Fork it to fit your team, or host it yourself.",
  },
] as const;

const ENDS = [
  {
    label: "Records",
    items: [
      "Zoom",
      "Google Meet",
      "Microsoft Teams",
      "The room you are in",
      "Voice recorder files",
    ],
  },
  {
    label: "Read by",
    items: ["Claude", "Cursor", "ChatGPT", "Any MCP client"],
  },
] as const;

export function LandingThesis() {
  return (
    <section
      aria-label="Why Tape starts with conversation"
      // A warm walnut rather than the ink of the open source section, so the
      // page keeps a single dramatic dark turn.
      className="bg-[oklch(0.3_0.035_45)] text-paper"
    >
      <Container className="py-20 lg:py-24">
        <FadeIn className="grid gap-x-16 gap-y-6 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end">
          <h2 className="font-display max-w-[22ch] text-display-2 tracking-[-0.02em] text-balance">
            Your team says more in one call than it writes{" "}
            <em className="italic text-brand">all week.</em>
          </h2>
          <p className="max-w-[44ch] text-[1.0625rem] leading-[1.65] text-pretty text-paper/70">
            Introductions, promises, open questions. Conversation is the richest
            record a team makes, and almost none of it is kept. Tape starts
            there.
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <ul className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TEAMS.map((item) => (
              <li key={item.team}>
                <a
                  href={item.href}
                  className="group flex h-full flex-col rounded-[1.25rem] bg-paper/7 px-6 py-6 transition-colors hover:bg-paper/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <span className="flex items-center justify-between gap-4 font-mono text-label uppercase tracking-[0.2em] text-paper/60">
                    For {item.team.toLowerCase()}
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 shrink-0 text-paper/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-brand"
                    />
                  </span>
                  <span className="mt-5 text-[1.0625rem] font-medium leading-[1.45] text-pretty text-paper">
                    {item.line}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </FadeIn>
        <FadeIn delay={0.15}>
          <div className="mt-12 flex flex-col gap-4">
            {ENDS.map((row) => (
              <div
                key={row.label}
                className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-center sm:gap-6"
              >
                <p className="font-mono text-label uppercase tracking-[0.2em] text-paper/50">
                  {row.label}
                </p>
                <p className="flex flex-wrap gap-x-5 gap-y-1">
                  {row.items.map((item) => (
                    <span
                      key={item}
                      className="whitespace-nowrap text-[0.9375rem] text-paper/80"
                    >
                      {item}
                    </span>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
