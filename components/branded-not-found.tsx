import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Not-found pages sit outside the workspace shell, so they borrow the sign-in
 * page's landing language: paper ground, mono eyebrow, Fraunces line, ink pill.
 */
export function BrandedNotFound({
  eyebrow,
  title,
  description,
  hint,
  actionHref = "/dashboard",
  actionLabel = "Back to Meetings",
}: {
  eyebrow: string;
  title: string;
  description: string;
  hint?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-paper font-landing text-ink antialiased">
      <header className="px-6 py-5 sm:px-10">
        <Link
          href="/"
          aria-label="Tape home"
          className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-graphite focus-visible:ring-offset-4"
        >
          <ProductLogo />
        </Link>
      </header>
      <div className="flex flex-1 items-center px-6 pb-24 sm:px-10">
        <div className="mx-auto w-full max-w-[30rem]">
          <p className="font-mono text-label uppercase tracking-[0.2em] text-brand-ink">
            {eyebrow}
          </p>
          <h1 className="font-display mt-5 text-display-3 tracking-[-0.02em] text-balance text-ink">
            {title}
          </h1>
          <p className="mt-4 text-[0.9375rem] leading-[1.7] text-pretty text-graphite">
            {description}
          </p>
          {hint ? (
            <p className="mt-3 text-[0.875rem] leading-[1.7] text-pretty text-graphite">
              {hint}
            </p>
          ) : null}
          <Link
            href={actionHref}
            className={cn(
              buttonVariants({ variant: "ink", size: "lg" }),
              "mt-9 h-11 px-6 text-[0.9375rem]",
            )}
          >
            {actionLabel}
          </Link>
        </div>
      </div>
    </main>
  );
}
