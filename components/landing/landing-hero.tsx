"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { motion, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";

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
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-paper via-paper via-[75%] to-transparent sm:hidden"
        />

        {/* intro copy */}
        <motion.div
          style={{ opacity: copyOpacity, y: copyY }}
          className="pointer-events-none relative mx-auto flex h-full w-full max-w-7xl items-center px-5 pb-24 pt-32 sm:px-8"
        >
          <div className="pointer-events-auto max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">
              Tape · Meeting intelligence, owned by you
            </p>
            <h1 className="font-display mt-7 text-6xl leading-[1.02] tracking-tight text-ink sm:text-7xl lg:text-[4.1rem]">
              Every conversation,
              <br />
              <em className="italic text-brand">on the record.</em>
            </h1>
            <p className="mt-7 max-w-[44ch] text-lg leading-8 text-ash">
              Tape records, transcribes, and understands your meetings — and you
              own every word. Search it on the web, or ask your AI assistant.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-7">
              <Link
                href="/auth/sign-in"
                className="inline-flex h-12 items-center rounded-full bg-ink px-8 text-[15px] font-medium text-paper transition-colors hover:bg-graphite"
              >
                Sign in to Tape
              </Link>
              <a
                href="#archive"
                className="border-b border-ink/25 pb-0.5 text-[15px] text-ink/70 transition-colors hover:border-ink hover:text-ink"
              >
                See how it works
              </a>
            </div>
          </div>
        </motion.div>

        {/* closing caption over the take-up detail shot */}
        <motion.div
          style={{ opacity: captionOpacity, y: captionY }}
          className="pointer-events-none absolute left-5 top-28 sm:left-8 lg:left-[calc((100vw-80rem)/2+2rem)] lg:top-32"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">
            While you talk
          </p>
          <p className="font-display mt-4 max-w-[16ch] text-3xl leading-[1.15] tracking-tight text-ink sm:text-4xl">
            It listens, <em className="italic">so you can think.</em>
          </p>
        </motion.div>
      </div>
    </section>
  );
}
