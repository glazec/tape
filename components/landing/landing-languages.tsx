"use client";

import Image from "next/image";

import {
  Container,
  FadeIn,
  Lede,
  NoteLine,
  SectionHeading,
  TrackLabel,
} from "./landing-section";
import { SideBySideTranscriptMockup } from "./mockups";

/**
 * The one full-bleed band among the tracks, after Granola's poster sections:
 * the bilingual transcript is the claim nobody else can show, so it gets the
 * whole width and a single line of support instead of a caption grid.
 */
export function LandingLanguages() {
  return (
    <section id="languages" className="scroll-mt-20 bg-paper">
      <Container className="pt-20 lg:pt-28">
        <FadeIn className="mx-auto flex max-w-[44rem] flex-col items-center text-center">
          <TrackLabel track="A2">Languages</TrackLabel>
          <SectionHeading className="mt-6">
            Two languages, <em className="italic">one transcript.</em>
          </SectionHeading>
          <Lede className="mx-auto">
            Teams switch languages mid-sentence. Tape keeps every line in the
            language it was said, with the translation right beside it.
          </Lede>
        </FadeIn>
      </Container>
      <FadeIn delay={0.1} className="mt-12 lg:mt-16">
        <div className="relative isolate overflow-hidden">
          <Image
            src="/media/art/braid.webp"
            alt=""
            fill
            sizes="100vw"
            className="-z-10 object-cover"
          />
          <Container className="py-14 sm:py-20 lg:py-28">
            <div className="mx-auto w-full max-w-[60rem] shadow-[0_30px_80px_-30px_oklch(0.19_0.007_30/0.45)]">
              <SideBySideTranscriptMockup />
            </div>
          </Container>
        </div>
      </FadeIn>
      <Container className="pb-20 pt-10 lg:pb-28">
        <NoteLine
          notes={[
            "No language to pick before the call",
            "Original beside translation",
            "Fix a name once and it stays fixed",
          ]}
        />
      </Container>
    </section>
  );
}
