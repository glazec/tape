"use client";

import Image from "next/image";

import meetingHub from "@/assets/product/meeting-hub.png";

import { FadeIn, SectionHeading, SectionLabel } from "./landing-section";

const POINTS = [
  {
    title: "You own the data",
    body: "Recordings and transcripts live in your workspace — exportable, searchable, never training public models.",
  },
  {
    title: "Search everywhere",
    body: "Full-text search across every meeting on the web — by company, founder, speaker, or anything said.",
  },
  {
    title: "Ask your AI assistant",
    body: "Tape's MCP server lets Claude, Cursor, and other assistants query your meeting archive — read-only, scoped to your access.",
  },
];

export function LandingArchive() {
  return (
    <section id="archive" className="border-b border-ink/10 bg-paper">
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_1.15fr] lg:py-32">
        <FadeIn>
          <SectionLabel>01 · Your archive</SectionLabel>
          <SectionHeading>
            Your archive,
            <br />
            <em className="italic text-graphite">your rules.</em>
          </SectionHeading>
          <div className="mt-10 flex flex-col gap-7">
            {POINTS.map((point) => (
              <div key={point.title} className="border-l border-ink/15 pl-5">
                <h3 className="text-[15px] font-medium text-ink">
                  {point.title}
                </h3>
                <p className="mt-1.5 max-w-[46ch] text-[15px] leading-7 text-ash">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>
        <FadeIn delay={0.12}>
          <div className="overflow-hidden rounded-2xl border border-ink/10 bg-mist shadow-[0_24px_60px_-24px_rgba(16,17,20,0.18)]">
            <Image
              src={meetingHub}
              alt="Tape meeting hub — searchable meeting library with related meetings grouped"
              className="h-auto w-full"
              placeholder="blur"
            />
          </div>
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-ash">
            The meeting hub — every call, searchable, related meetings grouped
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
