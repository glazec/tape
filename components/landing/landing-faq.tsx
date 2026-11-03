"use client";

import { Plus } from "lucide-react";

import { FAQ_ITEMS } from "./faq-items";
import {
  Container,
  FadeIn,
  SectionHeading,
  TrackLabel,
} from "./landing-section";

export function LandingFaq() {
  return (
    <section id="faq" className="scroll-mt-20 bg-mist/70">
      <Container className="grid gap-x-16 gap-y-10 py-20 [&>*]:min-w-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:py-28">
        <FadeIn>
          <TrackLabel track="B3">Liner notes</TrackLabel>
          <SectionHeading className="mt-6">Questions</SectionHeading>
        </FadeIn>
        <FadeIn delay={0.08}>
          <div className="flex flex-col gap-1">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.question}
                className="group rounded-xl px-5 transition-colors open:bg-paper hover:bg-paper/70"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[1rem] font-medium text-ink transition-colors hover:text-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <Plus
                    aria-hidden
                    className="size-4 shrink-0 text-graphite transition-transform duration-300 group-open:rotate-45"
                  />
                </summary>
                <p className="max-w-[60ch] pb-6 text-[0.9375rem] leading-[1.65] text-pretty text-graphite">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
