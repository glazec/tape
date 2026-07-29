"use client";

import { FAQ_ITEMS } from "./faq-items";
import { Container, FadeIn, SectionHeading, SectionLabel } from "./landing-section";

export function LandingFaq() {
  return (
    <section id="faq" className="border-b border-ink/8 bg-mist/70">
      <Container className="py-20 lg:py-28">
        <FadeIn className="max-w-[34rem]">
          <SectionLabel>07 · Questions</SectionLabel>
          <SectionHeading>
            The things people
            <br />
            <em className="italic text-graphite">ask first.</em>
          </SectionHeading>
        </FadeIn>
        <dl className="mt-14 grid gap-x-16 gap-y-10 border-t border-ink/8 pt-10 md:grid-cols-2">
          {FAQ_ITEMS.map((item, index) => (
            <FadeIn key={item.question} delay={(index % 2) * 0.08}>
              <dt className="text-[0.9375rem] font-medium leading-6 text-ink">
                {item.question}
              </dt>
              <dd className="mt-2.5 max-w-[52ch] text-[0.9375rem] leading-[1.7] text-pretty text-graphite">
                {item.answer}
              </dd>
            </FadeIn>
          ))}
        </dl>
      </Container>
    </section>
  );
}
