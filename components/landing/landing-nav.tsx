"use client";

import { motion } from "framer-motion";
import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

const EASE = [0.16, 1, 0.3, 1] as const;

const LINKS = [
  { href: "#archive", label: "Archive" },
  { href: "#recorder", label: "Recorder" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#enterprise", label: "Enterprise" },
];

export function LandingNav() {
  return (
    <motion.header
      initial={{ y: -64 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="fixed inset-x-0 top-0 z-50 border-b border-ink/10 bg-paper/85 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          aria-label="Tape home"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-graphite focus-visible:ring-offset-4"
        >
          <ProductLogo />
        </Link>
        <nav
          aria-label="Site"
          className="hidden items-center gap-8 font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 md:flex"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-5">
          <Link
            href="/auth/sign-in"
            className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 transition-colors hover:text-ink sm:inline"
          >
            Sign in
          </Link>
          <Link
            href="/auth/sign-in"
            className="inline-flex h-9 items-center rounded-full bg-ink px-5 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-paper transition-colors hover:bg-graphite"
          >
            Get started
          </Link>
        </div>
      </div>
    </motion.header>
  );
}
