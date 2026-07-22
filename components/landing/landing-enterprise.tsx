"use client";

import { FadeIn, SectionLabel } from "./landing-section";

const POINTS = [
  {
    title: "Multi-tenant workspaces",
    body: "Each team gets its own workspace with its own archive, members, and calendar connections.",
  },
  {
    title: "Access controls",
    body: "Members see their team's meetings. External readers only see what is explicitly shared with them.",
  },
  {
    title: "Share links with expiry",
    body: "Send a transcript outside the workspace with a link that expires — access ends when you say it ends.",
  },
];

export function LandingEnterprise() {
  return (
    <section id="enterprise" className="bg-ink text-paper">
      <div className="mx-auto w-full max-w-7xl px-5 py-24 sm:px-8 lg:py-32">
        <FadeIn>
          <SectionLabel className="text-brand">
            04 · Enterprise
          </SectionLabel>
          <h2 className="font-display mt-6 max-w-[18ch] text-4xl leading-[1.05] tracking-tight sm:text-5xl">
            Ready for the whole company,{" "}
            <em className="italic text-paper/60">careful with every word.</em>
          </h2>
        </FadeIn>
        <div className="mt-16 grid gap-10 md:grid-cols-3">
          {POINTS.map((point, i) => (
            <FadeIn key={point.title} delay={i * 0.08}>
              <div className="border-t border-paper/15 pt-6">
                <h3 className="text-[15px] font-medium">{point.title}</h3>
                <p className="mt-2.5 max-w-[38ch] text-[15px] leading-7 text-paper/60">
                  {point.body}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
