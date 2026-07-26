"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

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
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
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
  label,
  heading,
  points,
  still,
  caption,
  footer,
  flip = false,
  stillWidth = "wide",
  surface = "paper",
}: {
  id: string;
  label: ReactNode;
  heading: ReactNode;
  points: readonly Point[];
  still: ReactNode;
  caption: ReactNode;
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
          <SectionLabel>{label}</SectionLabel>
          <SectionHeading>{heading}</SectionHeading>
          <PointList points={points} />
          {footer}
        </FadeIn>
        <FadeIn delay={0.1} className={flip ? "lg:order-1" : undefined}>
          {still}
          <Caption>{caption}</Caption>
        </FadeIn>
      </Container>
    </section>
  );
}

/** Caption under a product still. Small, but never smaller than 11px. */
export function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="mt-5 font-mono text-label uppercase tracking-[0.16em] text-ash">
      {children}
    </p>
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
        "overflow-hidden rounded-xl border border-ink/10 bg-mist shadow-[0_28px_64px_-32px_oklch(0.195_0.012_30/0.28)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
