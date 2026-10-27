"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export const EASE = [0.16, 1, 0.3, 1] as const;

/** One measure for the whole public site, so every section edge lines up. */
export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[76rem] px-6 sm:px-8 lg:px-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  // The server cannot know the motion preference, so branching on it here
  // would hydrate a hidden element that never animates in. The reduced-motion
  // override lives in CSS instead (see [data-fade] in globals.css).
  return (
    <motion.div
      data-fade
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-label uppercase tracking-[0.2em] text-brand-ink",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionHeading({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "font-display mt-5 text-display-2 tracking-[-0.02em] text-balance text-ink",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function Lede({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "mt-6 max-w-[52ch] text-lede text-pretty text-graphite",
        className,
      )}
    >
      {children}
    </p>
  );
}

export type Point = { title: string; body: string };

/**
 * Feature points as a definition list. Whitespace and weight carry the
 * structure; no rules, no cards, nothing to repeat section after section.
 */
export function PointList({
  points,
  className,
}: {
  points: readonly Point[];
  className?: string;
}) {
  return (
    <dl className={cn("mt-10 flex flex-col gap-8", className)}>
      {points.map((point) => (
        <div key={point.title}>
          <dt className="text-[0.9375rem] font-medium leading-6 tracking-[-0.005em] text-ink">
            {point.title}
          </dt>
          <dd className="mt-2 max-w-[48ch] text-[0.9375rem] leading-[1.7] text-pretty text-graphite">
            {point.body}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The text-and-still section shape used by capture, languages, and memory.
 * `flip` puts the still on the left; `surface` alternates paper and mist so
 * consecutive sections do not read as one long column.
 */
export function SplitSection({
  id,
  heading,
  points,
  still,
  footer,
  flip = false,
  stillWidth = "wide",
  surface = "paper",
}: {
  id: string;
  heading: ReactNode;
  points: readonly Point[];
  still: ReactNode;
  footer?: ReactNode;
  flip?: boolean;
  /** A full app capture wants the wide track; a small app window does not. */
  stillWidth?: "wide" | "narrow";
  surface?: "paper" | "mist";
}) {
  const wideTrackOnLeft = flip === (stillWidth === "wide");

  return (
    <section
      id={id}
      className={cn(
        "border-b border-ink/8",
        surface === "mist" ? "bg-mist/70" : "bg-paper",
      )}
    >
      <Container
        className={cn(
          "grid items-start gap-x-16 gap-y-12 py-20 [&>*]:min-w-0 lg:py-28",
          // The wide track follows whichever column needs the room, so the
          // copy measure stays constant no matter which side the still is on.
          wideTrackOnLeft
            ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]"
            : "lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]",
        )}
      >
        <FadeIn className={flip ? "lg:order-2" : undefined}>
          <SectionHeading className="mt-0">{heading}</SectionHeading>
          <PointList points={points} />
          {footer}
        </FadeIn>
        <FadeIn delay={0.1} className={flip ? "lg:order-1" : undefined}>
          {still}
        </FadeIn>
      </Container>
    </section>
  );
}

/**
 * Product still. A fixed window crops the tall app captures instead of
 * scaling them down, so the two grid columns end at roughly the same place.
 */
export function Still({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-ink/10 bg-mist",
        className,
      )}
    >
      {children}
    </div>
  );
}
