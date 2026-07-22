"use client";

import Image from "next/image";

import transcriptReview from "@/assets/product/transcript-review.png";

import { FadeIn, SectionHeading, SectionLabel } from "./landing-section";

const POINTS = [
  {
    title: "Translation & polish",
    body: "Transcripts are cleaned up and translated across 30+ languages — read the meeting in the language you think in.",
  },
  {
    title: "Meeting analytics",
    body: "Emotion, talk-share, and words-per-minute per speaker, plus detected entities — people, companies, and amounts mentioned.",
  },
  {
    title: "Related meetings, grouped",
    body: "Recurring series and related calls are grouped automatically, so context carries over from week to week.",
  },
];

export function LandingIntelligence() {
  return (
    <section id="intelligence" className="border-b border-ink/10 bg-paper">
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[1fr_1.15fr] lg:py-32">
        <FadeIn>
          <SectionLabel>03 · Understanding</SectionLabel>
          <SectionHeading>
            Understands the
            <br />
            <em className="italic text-graphite">conversation.</em>
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
              src={transcriptReview}
              alt="Transcript review in Tape — speakers identified, translation in place"
              className="h-auto w-full"
              placeholder="blur"
            />
          </div>
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-ash">
            Speakers identified, translation alongside the original
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
