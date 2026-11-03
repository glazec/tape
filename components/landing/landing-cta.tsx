"use client";

import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";
import { DESKTOP_APP_DOWNLOAD_URL } from "@/lib/desktop-app";

import { ArtPanel, Container, FadeIn, TrackLabel } from "./landing-section";

const SECTION_LINKS = [
  { href: "#followup", label: "After the call" },
  { href: "#languages", label: "Languages" },
  { href: "#capture", label: "In the room" },
  { href: "#agents", label: "Agents" },
  { href: "#open-source", label: "Open source" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "Questions" },
];

const SITE_LINKS = [
  { href: "/blog", label: "Blog" },
  { href: "/auth/sign-in", label: "Sign in" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function LandingCta() {
  return (
    <>
      <section className="bg-paper">
        <Container className="py-20 lg:py-28">
          <FadeIn>
            <ArtPanel src="/media/art/hero.webp" className="min-h-[30rem]">
              <div className="flex max-w-[40rem] flex-col items-center rounded-[1.25rem] bg-paper/90 px-6 py-12 text-center backdrop-blur-sm sm:px-12 sm:py-14">
                <TrackLabel track="B4">Press record</TrackLabel>
                <h2 className="font-display mt-6 text-display-2 tracking-[-0.025em] text-balance text-ink">
                  Roll tape on{" "}
                  <em className="italic text-brand">your next meeting.</em>
                </h2>
                <p className="mt-5 max-w-[42ch] text-lede text-pretty text-graphite">
                  Connect a calendar, or record the room you are sitting in.
                  Tape takes it from there and hands you the archive.
                </p>
                <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/auth/sign-in"
                    className="inline-flex h-12 items-center rounded-full bg-ink px-8 text-[0.9375rem] font-medium text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
                  >
                    Start for free
                  </Link>
                  <a
                    href={DESKTOP_APP_DOWNLOAD_URL}
                    className="inline-flex h-12 items-center rounded-full bg-ink/6 px-8 text-[0.9375rem] font-medium text-ink transition-colors hover:bg-ink/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
                  >
                    Download for macOS
                  </a>
                </div>
                <p className="mt-5 text-[0.8125rem] text-ash">
                  No credit card. No seat licence.
                </p>
              </div>
            </ArtPanel>
          </FadeIn>
        </Container>
      </section>
      <footer className="overflow-hidden bg-paper">
        <Container className="flex flex-col gap-10 pb-6 pt-8">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-2.5">
              <ProductLogo />
              <p className="font-mono text-label uppercase tracking-[0.16em] text-ash">
                It&rsquo;s all on Tape
              </p>
            </div>
            <div className="flex flex-col gap-4 md:items-end">
              <nav
                aria-label="Sections"
                className="flex flex-wrap gap-x-7 gap-y-3 font-mono text-label uppercase tracking-[0.16em] text-graphite"
              >
                {SECTION_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="transition-colors hover:text-ink"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
              <nav
                aria-label="Site"
                className="flex flex-wrap gap-x-7 gap-y-3 font-mono text-label uppercase tracking-[0.16em] text-graphite"
              >
                {SITE_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="transition-colors hover:text-ink"
                  >
                    {link.label}
                  </Link>
                ))}
                <span className="text-ash">© 2026 Tape</span>
              </nav>
            </div>
          </div>
        </Container>
        {/* The closing wordmark, set like the label on a cassette spine and
            cropped by the page edge, after the Granola footer. */}
        <p
          aria-hidden
          className="font-display -mb-[0.22em] select-none text-center text-[clamp(5rem,30vw,32rem)] leading-[0.85] tracking-[-0.06em] text-ink"
        >
          tape<em className="italic text-brand">.</em>
        </p>
      </footer>
    </>
  );
}
