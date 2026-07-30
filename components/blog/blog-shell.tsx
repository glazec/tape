import Link from "next/link";
import type { ReactNode } from "react";

import { ProductLogo } from "@/components/product-logo";
import { cn } from "@/lib/utils";

export function BlogContainer({
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

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper font-landing text-ink antialiased">
      <header className="sticky top-0 z-40 border-b border-ink/8 bg-paper/90 backdrop-blur-md">
        <BlogContainer className="flex h-16 items-center justify-between gap-6">
          <Link
            href="/"
            aria-label="Tape home"
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-graphite focus-visible:ring-offset-4"
          >
            <ProductLogo />
          </Link>
          <nav
            aria-label="Journal"
            className="flex items-center gap-5 font-mono text-label uppercase tracking-[0.16em] sm:gap-7"
          >
            <Link
              href="/"
              className="hidden text-graphite transition-colors hover:text-ink sm:inline"
            >
              Home
            </Link>
            <Link
              href="/blog"
              aria-current="page"
              className="text-ink underline decoration-brand decoration-2 underline-offset-8"
            >
              Blog
            </Link>
            <Link
              href="/auth/sign-in"
              className="rounded-full bg-ink px-4 py-2 text-paper transition-colors hover:bg-graphite focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4"
            >
              Sign in
            </Link>
          </nav>
        </BlogContainer>
      </header>
      {children}
      <footer className="border-t border-ink/10 bg-paper">
        <BlogContainer className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <ProductLogo />
            <p className="font-mono text-label uppercase tracking-[0.16em] text-ash">
              Every conversation, on the record
            </p>
          </div>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-7 gap-y-3 font-mono text-label uppercase tracking-[0.16em] text-graphite"
          >
            <Link className="transition-colors hover:text-ink" href="/">
              Home
            </Link>
            <Link className="transition-colors hover:text-ink" href="/privacy">
              Privacy
            </Link>
            <Link className="transition-colors hover:text-ink" href="/terms">
              Terms
            </Link>
          </nav>
        </BlogContainer>
      </footer>
    </div>
  );
}
