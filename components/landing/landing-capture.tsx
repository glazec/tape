"use client";

import Image from "next/image";

import macosRecorder from "@/assets/product/macos-recorder.png";
import { DESKTOP_APP_DOWNLOAD_URL } from "@/lib/desktop-app";

import { SplitSection, Still, type Point } from "./landing-section";

const POINTS: readonly Point[] = [
  {
    title: "No bot in the room",
    body: "The macOS app records your microphone and system audio on your own machine. Nothing joins the call, nothing announces itself, and the conversation in front of you lands in the same archive as everything else.",
  },
  {
    title: "Or let it cover the calendar for you",
    body: "Connect a calendar and Tape can join your Zoom and Google Meet meetings on its own. Useful when you are double booked, and entirely optional.",
  },
  {
    title: "Speakers separated, then named",
    body: "Recordings are split by voice and matched to the people in the room, so every line arrives attached to whoever said it.",
  },
];

export function LandingCapture() {
  return (
    <SplitSection
      id="capture"
      label="04 · Capture"
      heading={
        <>
          It records
          <br />
          <em className="italic text-graphite">itself.</em>
        </>
      }
      points={POINTS}
      flip
      stillWidth="narrow"
      still={
        <Still className="mx-auto max-w-[22rem] rounded-[1.75rem] bg-paper">
          <Image
            src={macosRecorder}
            alt="Tape local recorder for macOS, recording microphone and system audio with one click"
            className="h-auto w-full"
            placeholder="blur"
            sizes="(min-width: 1024px) 352px, 100vw"
          />
        </Still>
      }
      caption="Tape for macOS · local recorder"
      footer={
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a
            href={DESKTOP_APP_DOWNLOAD_URL}
            className="inline-flex h-11 items-center rounded-full bg-ink px-6 text-[0.875rem] font-medium text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
          >
            Download for macOS
          </a>
          <a
            href="https://github.com/glazec/tape"
            target="_blank"
            rel="noreferrer"
            className="text-[0.875rem] text-graphite underline decoration-ink/25 underline-offset-[6px] transition-colors hover:text-ink hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
          >
            View on GitHub
          </a>
        </div>
      }
    />
  );
}
