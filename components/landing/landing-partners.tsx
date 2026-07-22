"use client";

import Image from "next/image";

import { FadeIn } from "./landing-section";

const PARTNERS = [
  { name: "Google Meet", src: "/brand/partners/googlemeet.svg", width: 22 },
  { name: "Zoom", src: "/brand/partners/zoom.svg", width: 22 },
  { name: "Recall.ai", src: null, width: 0 },
  { name: "ElevenLabs", src: "/brand/partners/elevenlabs.svg", width: 22 },
  { name: "Neon", src: "/brand/partners/neon.svg", width: 22 },
  { name: "Cloudflare", src: "/brand/partners/cloudflare.svg", width: 22 },
  { name: "OpenRouter", src: "/brand/partners/openrouter.svg", width: 22 },
];

export function LandingPartners() {
  return (
    <section className="border-b border-ink/10 bg-paper">
      <FadeIn className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8">
        <p className="text-center font-mono text-[11px] uppercase tracking-[0.22em] text-ash">
          Works with the tools your team already uses
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          {PARTNERS.map((p) => (
            <span
              key={p.name}
              className="flex items-center gap-2.5 text-graphite opacity-80 transition-opacity hover:opacity-100"
            >
              {p.src ? (
                <Image
                  src={p.src}
                  alt=""
                  width={p.width}
                  height={p.width}
                  unoptimized
                  className="h-[22px] w-[22px]"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-md border border-graphite/40 font-mono text-[11px] font-semibold"
                >
                  R
                </span>
              )}
              <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
                {p.name}
              </span>
            </span>
          ))}
        </div>
      </FadeIn>
    </section>
  );
}
