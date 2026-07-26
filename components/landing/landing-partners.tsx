"use client";

import Image from "next/image";

import { Container, FadeIn } from "./landing-section";

const PARTNERS = [
  { name: "Google Meet", src: "/brand/partners/googlemeet.svg" },
  { name: "Zoom", src: "/brand/partners/zoom.svg" },
  { name: "Recall.ai", src: null },
  { name: "ElevenLabs", src: "/brand/partners/elevenlabs.svg" },
  { name: "Neon", src: "/brand/partners/neon.svg" },
  { name: "Cloudflare", src: "/brand/partners/cloudflare.svg" },
  { name: "OpenRouter", src: "/brand/partners/openrouter.svg" },
];

export function LandingPartners() {
  return (
    <section className="border-b border-ink/8 bg-paper">
      <Container>
        <FadeIn className="py-12 lg:py-14">
          <p className="text-center font-mono text-label uppercase tracking-[0.18em] text-ash">
            Records wherever your team already meets
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
            {PARTNERS.map((partner) => (
              <span
                key={partner.name}
                className="flex items-center gap-2.5 text-graphite opacity-80 transition-opacity hover:opacity-100"
              >
                {partner.src ? (
                  <Image
                    src={partner.src}
                    alt=""
                    width={20}
                    height={20}
                    unoptimized
                    className="h-5 w-5"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="flex h-5 w-5 items-center justify-center rounded border border-graphite/40 font-mono text-[0.625rem] font-semibold"
                  >
                    R
                  </span>
                )}
                <span className="font-mono text-label uppercase tracking-[0.14em]">
                  {partner.name}
                </span>
              </span>
            ))}
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
