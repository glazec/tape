"use client";

import { MeetingSeriesMockup } from "./mockups";
import { SplitSection, type Point } from "./landing-section";

const POINTS: readonly Point[] = [
  {
    title: "Recurring calls become one thread",
    body: "Tape groups a series as the meetings arrive, so a weekly sync reads as a single running conversation instead of forty unrelated files. There are no folders to keep tidy.",
  },
  {
    title: "People, companies, and numbers, picked out",
    body: "Entities mentioned in the room are detected and linked, so you can follow one company across every meeting it came up in.",
  },
  {
    title: "How the room actually sounded",
    body: "Talk share, pace, and tone per speaker sit next to the transcript rather than in place of it. The record stays the record.",
  },
];

export function LandingMemory() {
  return (
    <SplitSection
      id="memory"
      label="01 · Memory"
      heading={
        <>
          Context that
          <br />
          <em className="italic text-graphite">carries over.</em>
        </>
      }
      points={POINTS}
      flip
      surface="mist"
      still={<MeetingSeriesMockup />}
      caption="Related meetings, grouped as they arrive"
    />
  );
}
