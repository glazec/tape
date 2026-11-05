"use client";

import { DESKTOP_APP_DOWNLOAD_URL } from "@/lib/desktop-app";

import { ArtPanel, TrackSection } from "./landing-section";
import { CalendarJoinMockup, RecorderMockup } from "./mockups";

const NOTES = [
  "Bots join Zoom and Meet from your calendar",
  "The Mac app records the room, no bot",
  "Upload files from any voice recorder",
  "Self-host it, one workspace per team",
] as const;

export function LandingCapture() {
  return (
    <TrackSection
      id="capture"
      track="A3"
      label="Every way in"
      heading={
        <>
          Bot, Mac, or recorder.
          <br />
          <em className="italic">One app.</em>
        </>
      }
      lede="Tape is the only tool that puts meeting bots, local recording on your Mac, and voice recorder uploads in one app you can host yourself, with a separate workspace for every team. When a bot is welcome, your calendar sends one to Zoom and Meet. When it is not, the Mac app records the room on your own machine. The recorder you carried to dinner uploads in one batch."
      notes={NOTES}
      panel={
        <div className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
          <ArtPanel
            src="/media/art/terrace-portrait.webp"
            className="aspect-[4/5] max-sm:aspect-auto"
          >
            <div className="w-full rounded-xl max-sm:mt-36 sm:max-w-[78%]">
              <RecorderMockup />
            </div>
          </ArtPanel>
          <ArtPanel
            src="/media/art/desk-portrait.webp"
            className="aspect-[4/5] max-sm:aspect-auto"
          >
            <div className="w-full rounded-xl max-sm:mt-36 sm:max-w-[78%]">
              <CalendarJoinMockup />
            </div>
          </ArtPanel>
        </div>
      }
      footer={
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a
            href={DESKTOP_APP_DOWNLOAD_URL}
            className="inline-flex h-11 items-center rounded-full bg-ink px-6 text-[0.875rem] font-medium text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
          >
            Download for macOS
          </a>
        </div>
      }
    />
  );
}
