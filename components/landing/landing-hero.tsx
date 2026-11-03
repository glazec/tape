"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";

import {
  formatGithubActivity,
  type GithubActivity,
} from "@/lib/github-activity";

import { LaunchFilmButton } from "./landing-launch-film";
import { Container, TrackLabel } from "./landing-section";

const WORKS_WITH = [
  { name: "Google Meet", src: "/brand/partners/googlemeet.svg" },
  { name: "Zoom", src: "/brand/partners/zoom.svg" },
];

/**
 * The hero loop is a painted tape ribbon drifting on paper, eight seconds that
 * end on the frame they start from. It is a plain muted video with the still as
 * its poster, so it costs one request and no WebGL, and it stops for anyone
 * who asked the system for reduced motion.
 */
function HeroLoop() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      if (query.matches) {
        video.pause();
      } else {
        void video.play().catch(() => undefined);
      }
    };

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <video
      ref={videoRef}
      aria-hidden
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      poster="/media/art/hero-loop-poster.webp"
      className="absolute inset-0 h-full w-full object-cover object-[80%_20%] sm:object-[62%_40%] lg:object-[72%_center]"
    >
      <source src="/media/hero-loop.mp4" type="video/mp4" />
    </video>
  );
}

export function LandingHero({ activity }: { activity: GithubActivity | null }) {
  return (
    <section className="relative isolate flex flex-col overflow-hidden bg-paper">
      <Container className="relative pb-12 pt-28 sm:pt-36 lg:flex lg:min-h-[min(100svh,56rem)] lg:items-center lg:pb-24 lg:pt-28">
        <div className="max-w-[46rem]">
          <TrackLabel track="Side A">Open source meeting memory</TrackLabel>
          <h1 className="font-display mt-7 text-display-hero tracking-[-0.035em] text-ink">
            It&rsquo;s all on <em className="italic text-brand">Tape.</em>
          </h1>
          <p className="mt-7 max-w-[34ch] text-[clamp(1.1875rem,1.05rem+0.45vw,1.4375rem)] font-medium leading-[1.35] tracking-[-0.01em] text-pretty text-ink">
            Your best thinking happens out loud. Tape records the call, or the
            room you are in with no bot. Every line in Chinese and English,
            turned into follow-ups your own AI can read.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-9 gap-y-4">
            <Link
              href="/auth/sign-in"
              className="inline-flex h-12 items-center rounded-full bg-ink px-8 text-[0.9375rem] font-medium text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
            >
              Start for free
            </Link>
            <LaunchFilmButton />
          </div>
          <p className="mt-12 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.8125rem] text-ash">
            Records
            {WORKS_WITH.map((tool) => (
              <span
                key={tool.name}
                className="inline-flex items-center gap-2 whitespace-nowrap text-graphite"
              >
                <Image
                  src={tool.src}
                  alt=""
                  width={16}
                  height={16}
                  unoptimized
                />
                {tool.name}
              </span>
            ))}
            <span className="text-graphite">Teams</span>
            <span className="whitespace-nowrap">or the room you are in</span>
          </p>
          {activity ? (
            <p className="mt-4 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ash">
              Open source · {formatGithubActivity(activity)}
            </p>
          ) : null}
        </div>
      </Container>

      {/* Below lg the loop sits under the copy as its own plate; from lg up it
          runs full-bleed and the copy sits in the empty paper on its left. */}
      <div className="relative mx-6 mb-6 aspect-[3/4] overflow-hidden sm:aspect-[16/10] rounded-[1.25rem] sm:mx-8 lg:absolute lg:inset-0 lg:-z-10 lg:m-0 lg:aspect-auto lg:rounded-none">
        <HeroLoop />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-paper from-25% via-paper/70 via-45% to-transparent to-65% lg:block"
        />
      </div>
    </section>
  );
}
