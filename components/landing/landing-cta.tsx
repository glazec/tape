"use client";

import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

import { FadeIn } from "./landing-section";

export function LandingCta() {
  return (
    <>
      <section className="bg-paper">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-10 px-5 py-24 sm:px-8 lg:py-32">
          <FadeIn>
            <h2 className="font-display max-w-[16ch] text-5xl leading-[1.02] tracking-tight text-ink sm:text-6xl">
              Your next meeting,{" "}
              <em className="italic text-brand">on the record.</em>
            </h2>
            <p className="mt-6 max-w-[46ch] text-lg leading-8 text-ash">
              Start with your next call. Tape records it, understands it, and
              hands you the archive — yours to keep.
            </p>
          </FadeIn>
          <FadeIn delay={0.1} className="flex flex-wrap items-center gap-7">
            <Link
              href="/auth/sign-in"
              className="inline-flex h-12 items-center rounded-full bg-ink px-8 text-[15px] font-medium text-paper transition-colors hover:bg-graphite"
            >
              Sign in to Tape
            </Link>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ash">
              SSO with Google · No credit card
            </p>
          </FadeIn>
        </div>
      </section>
      <footer className="border-t border-ink/10 bg-paper">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <ProductLogo />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
              Meeting intelligence
            </span>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-6 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/50"
          >
            <a href="#archive" className="transition-colors hover:text-ink">
              Archive
            </a>
            <a href="#recorder" className="transition-colors hover:text-ink">
              Recorder
            </a>
            <a
              href="#intelligence"
              className="transition-colors hover:text-ink"
            >
              Intelligence
            </a>
            <Link
              href="/auth/sign-in"
              className="transition-colors hover:text-ink"
            >
              Sign in
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-ink">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-ink">
              Terms
            </Link>
          </nav>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ash">
            © 2026 Tape
          </p>
        </div>
      </footer>
    </>
  );
}
