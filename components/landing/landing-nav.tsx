"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

import { Container } from "./landing-section";

const EASE = [0.16, 1, 0.3, 1] as const;

const LINKS = [
  { href: "#memory", label: "Memory" },
  { href: "#languages", label: "Languages" },
  { href: "#agents", label: "Agents" },
  { href: "#capture", label: "Capture" },
  { href: "#enterprise", label: "Enterprise" },
  { href: "#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
];

export function LandingNav() {
  const reducedMotion = useReducedMotion();

  return (
    <motion.header
      initial={reducedMotion ? false : { y: -64 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="fixed inset-x-0 top-0 z-50 border-b border-ink/8 bg-paper/85 backdrop-blur-md"
    >
      <Container className="flex h-16 items-center justify-between gap-8">
        <Link
          href="/"
          aria-label="Tape home"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-graphite focus-visible:ring-offset-4"
        >
          <ProductLogo />
        </Link>
        <nav
          aria-label="Site"
          className="hidden items-center gap-7 font-mono text-label uppercase tracking-[0.16em] text-graphite lg:flex"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-5">
          <Link
            href="/auth/sign-in"
            className="hidden font-mono text-label uppercase tracking-[0.16em] text-graphite transition-colors hover:text-ink sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-in"
            className="inline-flex h-9 items-center rounded-full bg-ink px-5 font-mono text-label font-medium uppercase tracking-[0.16em] text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
          >
            Get started
          </Link>
        </div>
      </Container>
    </motion.header>
  );
}
