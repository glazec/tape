"use client";

import { Container, FadeIn, SectionHeading } from "./landing-section";
import { SideBySideTranscriptMockup } from "./mockups";

const NOTES = [
  {
    title: "Nothing to set before the call",
    body: "Tape hears the language from the audio, so a sentence that starts in English and finishes in Mandarin still arrives as one clean line.",
  },
  {
    title: "Original beside translation",
    body: "Read at speed in either language and still check exactly what was said.",
  },
  {
    title: "Fix a word and it stays fixed",
    body: "Correct a name once. The edit holds for everyone who reads the meeting after you.",
  },
];

export function LandingLanguages() {
  return (
    <section id="languages" className="border-b border-ink/8 bg-paper">
      <Container className="py-20 lg:py-28">
        <FadeIn className="max-w-[40rem]">
          <SectionHeading className="mt-0">
            Two languages, <em className="italic">one transcript.</em>
          </SectionHeading>
        </FadeIn>
        <FadeIn delay={0.1} className="mt-12">
          <SideBySideTranscriptMockup />
        </FadeIn>
        <FadeIn delay={0.15}>
          <dl className="mt-10 grid gap-x-12 gap-y-6 text-[0.875rem] leading-[1.6] md:grid-cols-3">
            {NOTES.map((note) => (
              <div key={note.title}>
                <dt className="font-medium text-ink">{note.title}</dt>
                <dd className="mt-1 text-pretty text-graphite">{note.body}</dd>
              </div>
            ))}
          </dl>
        </FadeIn>
      </Container>
    </section>
  );
}
