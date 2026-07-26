"use client";

import { BilingualTranscriptMockup } from "./mockups";
import { SplitSection, type Point } from "./landing-section";

const POINTS: readonly Point[] = [
  {
    title: "Thirty languages, transcribed properly",
    body: "Mandarin, Japanese, Korean, German, Spanish, and more come back as clean text rather than phonetic guesswork, including calls where two languages trade off mid-sentence.",
  },
  {
    title: "Translation next to the original",
    body: "Every line keeps its source text beside the translation, so you can read at speed and still check exactly what was said.",
  },
  {
    title: "One archive, whatever the language",
    body: "Search in the language you think in and find the meeting that happened in another. Speakers, timestamps, and audio stay attached either way.",
  },
];

export function LandingLanguages() {
  return (
    <SplitSection
      id="languages"
      label="02 · Every language"
      heading={
        <>
          Read it in
          <br />
          <em className="italic text-graphite">your language.</em>
        </>
      }
      points={POINTS}
      still={<BilingualTranscriptMockup />}
      caption="Original and translation, line for line"
    />
  );
}
