import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

import { SignInForm } from "./sign-in-form";

const PANEL_POINTS = [
  "Recordings and transcripts stay in your workspace",
  "Search meetings, speakers, and transcript text",
  "Share selected transcripts with colleagues",
];

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const { callbackUrl } = await searchParams;
  const signInCallbackUrl = Array.isArray(callbackUrl)
    ? callbackUrl[0]
    : callbackUrl;

  return (
    <main className="grid min-h-screen bg-paper font-landing text-ink antialiased lg:grid-cols-2">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-ink text-paper lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div className="relative">
          <ProductLogo variant="light" />
        </div>
        <div className="relative">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">
            Meeting intelligence, owned by you
          </p>
          <h2 className="font-display mt-6 max-w-[15ch] text-5xl leading-[1.04] tracking-tight">
            Every conversation,{" "}
            <em className="italic text-paper/60">on the record.</em>
          </h2>
          <ul className="mt-12 flex flex-col gap-5">
            {PANEL_POINTS.map((point) => (
              <li
                key={point}
                className="flex items-start gap-4 border-t border-paper/12 pt-5"
              >
                <span
                  aria-hidden
                  className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                />
                <span className="text-[15px] leading-7 text-paper/75">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative font-mono text-[10px] uppercase tracking-[0.22em] text-paper/40">
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
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/60 transition-colors hover:text-ink"
          >
            ← Back to site
          </Link>
        </header>
        <div className="relative flex flex-1 items-center justify-center px-6 pb-16 sm:px-10">
          <div className="w-full max-w-md">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-brand">
              Workspace access
            </p>
            <h1 className="font-display mt-5 text-4xl leading-tight tracking-tight sm:text-5xl">
              Sign in to Tape.
            </h1>
            <p className="mt-5 text-base leading-7 text-ash">
              Use your company Google account to open your team&apos;s meeting
              workspace and review recordings, transcripts, and shared meetings.
            </p>
            <div className="mt-10">
              <SignInForm callbackUrl={signInCallbackUrl} />
            </div>
            <p className="mt-10 border-t border-ink/10 pt-6 text-sm leading-6 text-ash">
              Access follows your workspace membership and meetings shared with
              your account.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
