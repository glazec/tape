"use client";

import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

import { Container, FadeIn, Lede } from "./landing-section";

const SECTION_LINKS = [
  { href: "#memory", label: "Memory" },
  { href: "#languages", label: "Languages" },
  { href: "#agents", label: "Agents" },
  { href: "#capture", label: "Capture" },
  { href: "#enterprise", label: "Enterprise" },
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
        <Container className="py-28 lg:py-36">
          <FadeIn className="max-w-[34rem]">
            <h2 className="font-display text-display-2 tracking-[-0.02em] text-balance text-ink">
              Your next meeting,{" "}
              <em className="italic text-brand">on the record.</em>
            </h2>
            <Lede>
              Connect a calendar, or record the room you are sitting in. Tape
              takes it from there and hands you the archive.
            </Lede>
            <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
              <Link
                href="/auth/sign-in"
                className="inline-flex h-12 items-center rounded-full bg-ink px-8 text-[0.9375rem] font-medium text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
              >
                Sign in to Tape
              </Link>
              <p className="font-mono text-label uppercase tracking-[0.16em] text-ash">
                SSO with Google · No credit card
              </p>
            </div>
          </FadeIn>
        </Container>
      </section>
      <footer className="border-t border-ink/10 bg-paper">
        <Container className="flex flex-col gap-8 py-12">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-2.5">
              <ProductLogo />
              <p className="font-mono text-label uppercase tracking-[0.16em] text-ash">
                Meeting intelligence, owned by you
              </p>
            </div>
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
          </div>
          <div className="flex flex-col-reverse gap-4 border-t border-ink/8 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-label uppercase tracking-[0.16em] text-ash">
              © 2026 Tape
            </p>
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
            </nav>
          </div>
        </Container>
      </footer>
    </>
  );
}
