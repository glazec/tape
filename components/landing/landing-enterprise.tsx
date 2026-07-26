"use client";

import { Container, FadeIn, SectionLabel, type Point } from "./landing-section";
import { ShareSeriesMockup } from "./mockups";

const POINTS: readonly Point[] = [
  {
    title: "A workspace per team",
    body: "Each team gets its own archive, its own members, and its own calendar connections. Nothing leaks sideways.",
  },
  {
    title: "Nobody wonders what they missed",
    body: "Share a recurring series once and a colleague receives every future instance of it, without having to ask again.",
  },
  {
    title: "Access that matches the room",
    body: "Members see their team's meetings. External readers see only what was handed to them, and nothing else in the archive.",
  },
  {
    title: "Links that stop working",
    body: "Send a transcript outside the workspace with a link that expires. Access ends when you decide it ends.",
  },
];

export function LandingEnterprise() {
  return (
    <section id="enterprise" className="bg-ink text-paper">
      <Container className="py-24 lg:py-32">
        {/* Heading runs the full measure: it needs the room to break into two
            clean lines before the italic clause. */}
        <FadeIn>
          <SectionLabel className="text-brand">05 · Enterprise</SectionLabel>
          <h2 className="font-display mt-5 text-display-2 tracking-[-0.02em]">
            Built for the whole company,
            <br />
            <em className="italic text-paper/55">careful with every word.</em>
          </h2>
        </FadeIn>
        <div className="mt-14 grid gap-x-16 gap-y-12 [&>*]:min-w-0 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
          <FadeIn>
            <ShareSeriesMockup />
          </FadeIn>
          <dl className="grid gap-x-12 gap-y-9 sm:grid-cols-2">
            {POINTS.map((point, index) => (
              <FadeIn key={point.title} delay={index * 0.07}>
                <div className="border-t border-paper/15 pt-5">
                  <dt className="text-[0.9375rem] font-medium leading-6">
                    {point.title}
                  </dt>
                  <dd className="mt-2.5 max-w-[34ch] text-[0.9375rem] leading-[1.75] text-pretty text-paper/70">
                    {point.body}
                  </dd>
                </div>
              </FadeIn>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}
