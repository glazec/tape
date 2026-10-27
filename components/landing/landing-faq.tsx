"use client";

import { Plus } from "lucide-react";

import { FAQ_ITEMS } from "./faq-items";
import { Container, FadeIn, SectionHeading } from "./landing-section";

export function LandingFaq() {
  return (
    <section id="faq" className="border-b border-ink/8 bg-mist/70">
      <Container className="grid gap-x-16 gap-y-10 py-20 [&>*]:min-w-0 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:py-28">
        <FadeIn>
          <SectionHeading className="mt-0">Questions</SectionHeading>
        </FadeIn>
        <FadeIn delay={0.08}>
          <div className="border-t border-ink/10">
            {FAQ_ITEMS.map((item) => (
              <details
                key={item.question}
                className="group border-b border-ink/10"
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
