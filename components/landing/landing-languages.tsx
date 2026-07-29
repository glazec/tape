"use client";

import { BilingualTranscriptMockup } from "./mockups";
import { SplitSection, type Point } from "./landing-section";

const POINTS: readonly Point[] = [
  {
    title: "Nothing to set before the call",
    body: "Other tools make you name the language first and mangle the meeting when you guess wrong. Tape picks it up from the audio, so a sentence that starts in English and finishes in Mandarin still arrives as one clean line.",
  },
  {
    title: "Chinese and English, line for line",
    body: "Every line keeps its original text beside the translation, so you can read at speed and still check exactly what was said.",
  },
  {
    title: "Fix a word and it stays fixed",
    body: "Names and jargon that came back wrong are yours to correct. The edit holds for everyone reading the meeting afterwards.",
  },
];

export function LandingLanguages() {
  return (
    <SplitSection
      id="languages"
      label="02 · Every language"
      heading={
        <>
          Two languages,
          <br />
          <em className="italic text-graphite">one transcript.</em>
        </>
      }
      points={POINTS}
      still={<BilingualTranscriptMockup />}
      caption="Original and translation, line for line"
    />
  );
}
