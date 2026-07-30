import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

import { SignInForm } from "./sign-in-form";

const PANEL_POINTS = [
  "Bots for scheduled calls, a local recorder for the room",
  "Transcribed and translated across 30+ languages",
  "Searchable by your team, or by your own AI assistant",
];

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    reason?: string | string[];
  }>;
}) {
  const { callbackUrl, reason } = await searchParams;
  const signInCallbackUrl = Array.isArray(callbackUrl)
    ? callbackUrl[0]
    : callbackUrl;
  const signInReason = Array.isArray(reason) ? reason[0] : reason;

  return (
    <main className="grid min-h-screen bg-paper font-landing text-ink antialiased lg:grid-cols-2">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-ink text-paper lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="relative">
          <ProductLogo variant="light" />
        </div>
        <div className="relative">
          <p className="font-mono text-label uppercase tracking-[0.2em] text-brand">
            Meeting intelligence, owned by you
          </p>
          <h2 className="font-display mt-5 max-w-[16ch] text-display-2 tracking-[-0.02em] text-balance">
            Every conversation,{" "}
            <em className="italic text-paper/55">on the record.</em>
          </h2>
          <ul className="mt-11 flex max-w-[36ch] flex-col gap-4">
            {PANEL_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3.5">
                <span
                  aria-hidden
                  className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-brand"
                />
                <span className="text-[0.9375rem] leading-[1.75] text-pretty text-paper/75">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative font-mono text-label uppercase tracking-[0.16em] text-paper/60">
          Zoom · Google Meet · Local macOS recorder
        </p>
      </section>

      {/* Sign-in panel */}
      <section className="relative flex flex-col">
        <header className="relative flex items-center justify-between px-6 py-5 sm:px-10 lg:justify-end">
          <Link
            href="/"
            aria-label="Tape home"
            className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-graphite focus-visible:ring-offset-4 lg:hidden"
          >
            <ProductLogo />
          </Link>
          <Link
            href="/"
            className="font-mono text-label uppercase tracking-[0.16em] text-graphite transition-colors hover:text-ink"
          >
            ← Back to site
          </Link>
        </header>
        <div className="relative flex flex-1 items-center px-6 pb-16 sm:px-10 lg:px-16">
          <div className="w-full max-w-[26rem]">
            <p className="font-mono text-label uppercase tracking-[0.2em] text-brand-ink">
              Workspace access
            </p>
            <h1 className="font-display mt-5 text-display-3 tracking-[-0.02em] text-ink">
              Sign in to Tape.
            </h1>
            <p className="mt-4 text-[0.9375rem] leading-[1.7] text-pretty text-graphite">
              Use any Google account to create your meeting workspace or open
              meetings shared with you.
            </p>
            {signInReason === "dashboard_load_failed" ? (
              <div
                role="alert"
                className="mt-6 rounded-lg border border-destructive/30 bg-destructive/8 p-4 text-[0.875rem] leading-[1.7] text-destructive"
              >
                We could not open your dashboard. Sign in again to retry.
              </div>
            ) : null}
            <div className="mt-9">
              <SignInForm callbackUrl={signInCallbackUrl} />
            </div>
            <p className="mt-9 border-t border-ink/10 pt-6 text-[0.875rem] leading-[1.7] text-pretty text-graphite">
              New personal workspaces include $5 of provider credit. Existing
              organization workspaces keep their current access.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
