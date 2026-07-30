"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, useMotionValue, useTransform } from "framer-motion";
import Link from "next/link";

import { Container } from "./landing-section";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

/**
 * The scroll-driven scene is a WebGL render with an environment map behind it,
 * which is far too much work for a phone and pointless for anyone who asked for
 * reduced motion. Load it only on a large fine-pointer viewport, and only once
 * the browser is idle, so three.js never competes with first paint. Everyone
 * else gets the still motif below, which costs nothing.
 */
function useHeroSceneEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(
      "(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );

    let idleHandle: number | null = null;

    const cancelIdle = () => {
      if (idleHandle === null) return;
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
      idleHandle = null;
    };

    const sync = () => {
      cancelIdle();

      if (!query.matches) {
        setEnabled(false);
        return;
      }

      idleHandle =
        typeof window.requestIdleCallback === "function"
          ? window.requestIdleCallback(() => setEnabled(true), { timeout: 1200 })
          : window.setTimeout(() => setEnabled(true), 300);
    };

    sync();
    query.addEventListener("change", sync);

    return () => {
      cancelIdle();
      query.removeEventListener("change", sync);
    };
  }, []);

  return enabled;
}

/** Still spools, for viewports that do not get the animated scene. */
function HeroStill() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 420 260"
      className="h-full w-full text-ink"
      preserveAspectRatio="xMidYMid meet"
    >
      <g fill="none" stroke="currentColor" opacity={0.16}>
        <circle cx="120" cy="130" r="42" strokeWidth="5" />
        <circle cx="300" cy="130" r="74" strokeWidth="5" />
        <path d="M120 88h180" strokeWidth="4" />
        <path d="M120 172h180" strokeWidth="4" />
      </g>
      <g fill="currentColor" opacity={0.16}>
        <circle cx="120" cy="130" r="12" />
        <circle cx="300" cy="130" r="20" />
      </g>
    </svg>
  );
}

export function LandingHero() {
  const regionRef = useRef<HTMLElement>(null);
  const sceneEnabled = useHeroSceneEnabled();
  // Measured manually — deterministic 0→1 across the sticky region.
  const scrollYProgress = useMotionValue(0);

  useEffect(() => {
    if (!sceneEnabled) return;

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
  }, [scrollYProgress, sceneEnabled]);

  // Beat 1: intro copy fades/slides out as the wind begins.
  const copyOpacity = useTransform(scrollYProgress, [0.04, 0.26], [1, 0]);
  const copyY = useTransform(scrollYProgress, [0.04, 0.3], [0, -48]);
  // Beat 2: closing caption fades in over the take-up detail shot.
  const captionOpacity = useTransform(scrollYProgress, [0.72, 0.9], [0, 1]);
  const captionY = useTransform(scrollYProgress, [0.72, 0.92], [28, 0]);

  return (
    <section
      ref={regionRef}
      className={
        sceneEnabled ? "relative h-[300vh] bg-paper" : "relative bg-paper"
      }
    >
      <div
        className={
          sceneEnabled
            ? "sticky top-0 h-screen overflow-hidden"
            : "relative overflow-hidden"
        }
      >
        {/* full-bleed 3D scene, or the still motif in its place */}
        <div className="absolute inset-0">
          {sceneEnabled ? (
            <HeroScene progress={scrollYProgress} />
          ) : (
            // Below sm the copy fills the measure, so the motif would only
            // show as a cropped arc behind the text. Type carries it instead.
            <div className="hidden h-full items-center justify-end pr-[6vw] sm:flex">
              <div className="h-[48%] w-[52%] max-w-[24rem]">
                <HeroStill />
              </div>
            </div>
          )}
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
          style={sceneEnabled ? { opacity: copyOpacity, y: copyY } : undefined}
          className={
            sceneEnabled
              ? "pointer-events-none relative flex h-full items-center pb-20 pt-24 sm:pt-28"
              : "pointer-events-none relative flex items-center pb-16 pt-32 sm:pb-24 sm:pt-40"
          }
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
        {sceneEnabled ? (
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
        ) : null}
      </div>
    </section>
  );
}
