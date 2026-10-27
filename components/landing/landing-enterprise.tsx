"use client";

import { REPOSITORY_URL } from "@/lib/site";

import { Container, FadeIn } from "./landing-section";

/**
 * Six commitments read as one paragraph. Each claim is short enough to stand
 * on its own, so they carry the section without cards or a feature grid.
 */
const CLAIMS = [
  {
    claim: "Every team gets its own workspace.",
    detail: "Nothing leaks sideways.",
  },
  {
    claim: "Readers see what was handed to them,",
    detail: "and nothing else in the archive.",
  },
  { claim: "Share links expire", detail: "when you decide they do." },
  { claim: "Share a series once", detail: "and every future meeting follows." },
  { claim: "Any meeting leaves as text and mp3,", detail: "on every plan." },
  {
    claim: "Nothing trains a public model.",
    detail: "The source is open if you would rather check.",
  },
];

export function LandingEnterprise() {
  return (
    <section id="enterprise" className="bg-ink text-paper">
      <Container className="py-24 lg:py-36">
        <FadeIn>
          <h2 className="font-display max-w-[20ch] text-display-2 tracking-[-0.02em]">
            Built for the whole company,{" "}
            <em className="italic text-brand">careful with every word.</em>
          </h2>
        </FadeIn>
        <FadeIn delay={0.1}>
          <p className="font-display mt-14 max-w-[52rem] text-[clamp(1.375rem,1.1rem+1vw,1.875rem)] leading-[1.45] tracking-[-0.01em] text-pretty">
            {CLAIMS.map((item) => (
              <span key={item.claim}>
                {item.claim}{" "}
                <span className="text-paper/45">{item.detail}</span>{" "}
              </span>
            ))}
          </p>
        </FadeIn>
        <FadeIn delay={0.15}>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-12 inline-block rounded-sm text-[0.9375rem] text-paper/80 underline decoration-paper/30 underline-offset-[6px] transition-colors hover:text-paper hover:decoration-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4 focus-visible:ring-offset-ink"
          >
            Read the source on GitHub
          </a>
        </FadeIn>
      </Container>
    </section>
  );
}
