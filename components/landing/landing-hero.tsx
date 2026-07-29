"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { motion, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";

import { Container } from "./landing-section";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function LandingHero() {
  const regionRef = useRef<HTMLElement>(null);
  // Measured manually — deterministic 0→1 across the sticky region.
  const scrollYProgress = useMotionValue(0);
  useEffect(() => {
    const measure = () => {
      const el = regionRef.current;
      if (!el) return;
      const max = el.offsetHeight - window.innerHeight;
      const p =
        max > 0
          ? Math.min(1, Math.max(0, (window.scrollY - el.offsetTop) / max))
          : 0;
      scrollYProgress.set(p);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [scrollYProgress]);

  // Beat 1: intro copy fades/slides out as the wind begins.
  const copyOpacity = useTransform(scrollYProgress, [0.04, 0.26], [1, 0]);
  const copyY = useTransform(scrollYProgress, [0.04, 0.3], [0, -48]);
  // Beat 2: closing caption fades in over the take-up detail shot.
  const captionOpacity = useTransform(scrollYProgress, [0.72, 0.9], [0, 1]);
  const captionY = useTransform(scrollYProgress, [0.72, 0.92], [28, 0]);

  const reducedMotion = usePrefersReducedMotion();

  return (
    <section
      ref={regionRef}
      className={
        reducedMotion
          ? "relative bg-paper"
          : "relative h-[220vh] bg-paper lg:h-[300vh]"
      }
    >
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* full-bleed 3D scene */}
        <div className="absolute inset-0">
          <HeroScene progress={scrollYProgress} />
        </div>
        {/* Keeps the copy legible where the tape ribbon crosses behind it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-paper via-paper via-[75%] to-transparent sm:hidden"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-paper from-25% via-paper/80 via-50% to-transparent to-70% sm:block"
        />

        {/* intro copy */}
        <motion.div
          style={{ opacity: copyOpacity, y: copyY }}
          className="pointer-events-none relative flex h-full items-center pb-20 pt-24 sm:pt-28"
        >
          <Container>
            <div className="pointer-events-auto max-w-[42rem]">
              <p className="font-mono text-label uppercase tracking-[0.2em] text-brand-ink">
                Meeting intelligence, owned by you
              </p>
              <h1 className="font-display mt-6 text-display-1 tracking-[-0.025em] text-ink">
                Every conversation,
                <br />
                <em className="italic text-brand">on the record.</em>
              </h1>
              <p className="mt-7 max-w-[46ch] text-lede text-pretty text-graphite">
                Nothing to pick before the call, nothing to file after it. Every
                conversation comes back transcribed in the language it happened
                in, readable in Chinese or English, and open to the AI
                assistant you already work in.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
                <Link
                  href="/auth/sign-in"
                  className="inline-flex h-12 items-center rounded-full bg-ink px-8 text-[0.9375rem] font-medium text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
                >
                  Sign in to Tape
                </Link>
                <a
                  href="#memory"
                  className="rounded-sm text-[0.9375rem] text-graphite underline decoration-ink/25 underline-offset-[6px] transition-colors hover:text-ink hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
                >
                  See how it works
                </a>
              </div>
            </div>
          </Container>
        </motion.div>

        {/* closing caption over the take-up detail shot */}
        <motion.div
          style={{ opacity: captionOpacity, y: captionY }}
          className="pointer-events-none absolute inset-x-0 top-28 lg:top-32"
        >
          <Container>
            <p className="font-mono text-label uppercase tracking-[0.2em] text-brand-ink">
              While you talk
            </p>
            <p className="font-display mt-4 max-w-[17ch] text-display-3 tracking-[-0.02em] text-ink">
              It listens, <em className="italic">so you can think.</em>
            </p>
          </Container>
        </motion.div>
      </div>
    </section>
  );
}
