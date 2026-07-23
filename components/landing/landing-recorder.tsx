"use client";

import Image from "next/image";

import macosRecorder from "@/assets/product/macos-recorder.png";

import { FadeIn, SectionHeading, SectionLabel } from "./landing-section";

const POINTS = [
  {
    title: "Bots join your calls",
    body: "Connect your calendar and Tape's recorder joins Zoom and Google Meet automatically — no plugins, no invites to remember.",
  },
  {
    title: "A local recorder for everything else",
    body: "The companion macOS app records your microphone and system audio right on your machine — in-person chats, ad-hoc calls, anything.",
  },
  {
    title: "Speaker recognition built in",
    body: "Local recordings are transcribed with speakers separated, so every voice lands on the right name.",
  },
];

export function LandingRecorder() {
  return (
    <section id="recorder" className="border-b border-ink/10 bg-mist/60">
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[1.1fr_1fr] lg:py-32">
        <FadeIn className="order-2 lg:order-1">
          <div className="mx-auto max-w-[340px]">
            <div className="overflow-hidden rounded-[28px] border border-ink/10 bg-paper shadow-[0_28px_70px_-28px_rgba(16,17,20,0.25)]">
              <Image
                src={macosRecorder}
                alt="Tape local recorder for macOS — record mic and system audio with one click"
                className="h-auto w-full"
                placeholder="blur"
              />
            </div>
            <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-ash">
              Tape for macOS — local recorder
            </p>
          </div>
        </FadeIn>
        <FadeIn delay={0.12} className="order-1 lg:order-2">
          <SectionLabel>02 · Capture</SectionLabel>
          <SectionHeading>
            It records
            <br />
            <em className="italic text-graphite">itself.</em>
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
          <div className="mt-10 flex flex-wrap items-center gap-6">
            <a
              href="https://github.com/glazec/tape/releases/download/mac-v0.2.0/MeetingNoteLocalRecorder-0.2.0.zip"
              className="inline-flex min-h-11 items-center rounded-full bg-ink px-6 text-[14px] font-medium text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
            >
              Download for macOS
            </a>
            <a
              href="https://github.com/glazec/tape"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center border-b border-ink/25 text-[14px] text-ink/70 transition-colors hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
            >
              View on GitHub
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
