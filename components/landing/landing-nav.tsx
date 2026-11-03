"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

import { Container } from "./landing-section";

const EASE = [0.16, 1, 0.3, 1] as const;

const LINKS = [
  { href: "#followup", label: "Follow-ups" },
  { href: "#languages", label: "Bilingual" },
  { href: "#capture", label: "Mac app" },
  { href: "#agents", label: "Agents" },
  { href: "#open-source", label: "Open source" },
  { href: "#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  // Reduced motion is honoured in CSS through [data-fade]; branching on the
  // preference here would differ between the server and client renders.
  return (
    <motion.header
      data-fade
      initial={{ y: -64 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="fixed inset-x-0 top-0 z-50 bg-paper/80 backdrop-blur-md"
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
          className="hidden items-center gap-7 font-mono text-label uppercase tracking-[0.16em] whitespace-nowrap text-graphite xl:flex"
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
            Start free
          </Link>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="landing-menu"
            onClick={() => setOpen((value) => !value)}
            className="-mr-2 inline-flex size-10 items-center justify-center rounded-full text-ink transition-colors hover:bg-mist focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand xl:hidden"
          >
            {open ? (
              <X aria-hidden className="size-5" />
            ) : (
              <Menu aria-hidden className="size-5" />
            )}
          </button>
        </div>
      </Container>
      {open ? (
        <nav
          id="landing-menu"
          aria-label="Site"
          className="h-[calc(100svh-4rem)] overflow-y-auto bg-paper xl:hidden"
        >
          <Container className="flex flex-col pb-6 pt-2">
            {[...LINKS, { href: "/auth/sign-in", label: "Sign in" }].map(
              (link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="font-display rounded-lg py-3 text-display-3 tracking-[-0.02em] text-ink transition-colors hover:text-graphite"
                >
                  {link.label}
                </Link>
              ),
            )}
          </Container>
        </nav>
      ) : null}
    </motion.header>
  );
}
