"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import Image from "next/image";

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

/**
 * Sections are numbered like tracks on a cassette, A1 through A4 for the
 * product and B1 for the trust side, so the page reads as one tape.
 */
export function TrackLabel({
  track,
  children,
  className,
  tone = "light",
}: {
  track: string;
  children: ReactNode;
  className?: string;
  tone?: "light" | "dark";
}) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-label uppercase tracking-[0.2em]",
        tone === "dark" ? "text-paper/70" : "text-brand-ink",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 tabular-nums",
          tone === "dark" ? "bg-paper/10 text-paper" : "bg-brand/10",
        )}
      >
        {track}
      </span>
      {children}
    </p>
  );
}

/**
 * A painted panel with a product window floating on it, after the editorial
 * art plates Granola uses. The art carries mood; the window carries the claim.
 */
export function ArtPanel({
  src,
  children,
  className,
  priority = false,
  plainOnPhone = false,
}: {
  src: string;
  children?: ReactNode;
  className?: string;
  priority?: boolean;
  /** Drop the art on phones, where it would only add scroll above the window. */
  plainOnPhone?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[1.25rem] bg-mist",
        plainOnPhone && "max-sm:rounded-none max-sm:bg-transparent",
        className,
      )}
    >
      <Image
        src={src}
        alt=""
        fill
        priority={priority}
        sizes="(min-width: 1024px) 76rem, 100vw"
        className={cn("-z-10 object-cover", plainOnPhone && "max-sm:hidden")}
      />
      {children ? (
        <div
          className={cn(
            "flex h-full w-full items-center justify-center px-4 py-10 sm:px-10 sm:py-14 lg:px-16 lg:py-20 [&>*]:shadow-[0_30px_80px_-30px_oklch(0.19_0.007_30/0.45)]",
            plainOnPhone && "max-sm:p-0 max-sm:[&>*]:shadow-none",
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The shape every track section shares: label and heading on the left, the
 * argument on the right, then a full-width painted panel carrying the proof.
 */
export function TrackSection({
  id,
  track,
  label,
  heading,
  lede,
  points,
  notes,
  panel,
  footer,
}: {
  id: string;
  track: string;
  label: string;
  heading: ReactNode;
  lede?: ReactNode;
  points?: readonly Point[];
  /** Short phrases set as one mono line, instead of the three-column points. */
  notes?: readonly string[];
  panel: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 bg-paper">
      <Container className="py-20 lg:py-28">
        <div className="grid gap-x-16 gap-y-8 [&>*]:min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-end">
          <FadeIn>
            <TrackLabel track={track}>{label}</TrackLabel>
            <SectionHeading className="mt-6">{heading}</SectionHeading>
          </FadeIn>
          <FadeIn delay={0.08}>
            {lede ? <Lede className="mt-0">{lede}</Lede> : null}
            {footer}
          </FadeIn>
        </div>
        <FadeIn delay={0.12} className="mt-12 lg:mt-14">
          {panel}
        </FadeIn>
        {points ? (
          <FadeIn delay={0.16}>
            <dl className="mt-12 grid gap-x-14 gap-y-8 md:grid-cols-3">
              {points.map((point) => (
                <div key={point.title}>
                  <dt className="text-[0.9375rem] font-medium leading-6 text-ink">
                    {point.title}
                  </dt>
                  <dd className="mt-2 max-w-[42ch] text-[0.9375rem] leading-[1.7] text-pretty text-graphite">
                    {point.body}
                  </dd>
                </div>
              ))}
            </dl>
          </FadeIn>
        ) : null}
        {notes ? <NoteLine notes={notes} className="mt-10" /> : null}
      </Container>
    </section>
  );
}

/** Three short phrases on one mono line with coral dots, stacked on phones. */
export function NoteLine({
  notes,
  className,
}: {
  notes: readonly string[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "mx-auto flex max-w-[60rem] flex-col items-center gap-3 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-graphite md:flex-row md:justify-center md:gap-8",
        className,
      )}
    >
      {notes.map((note) => (
        <li key={note} className="flex items-center gap-3">
          <span aria-hidden className="size-1.5 rounded-full bg-brand" />
          {note}
        </li>
      ))}
    </ul>
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
