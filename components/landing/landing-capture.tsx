"use client";

import { DESKTOP_APP_DOWNLOAD_URL } from "@/lib/desktop-app";

import { ArtPanel, TrackSection } from "./landing-section";
import { CalendarJoinMockup, RecorderMockup } from "./mockups";

const NOTES = [
  "In-person meetings on your Mac",
  "No bot joins unless you send one",
  "Zoom and Meet from your calendar, if you want",
] as const;

export function LandingCapture() {
  return (
    <TrackSection
      id="capture"
      track="A3"
      label="In the room"
      heading={
        <>
          Record the room.
          <br />
          <em className="italic">Skip the bot.</em>
        </>
      }
      lede="Some conversations should never have a guest bot in them. The Mac app records your microphone and system audio on your own machine: a meeting across the table, a Teams call, a coffee. When a bot is welcome, your calendar sends one to Zoom and Meet."
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
