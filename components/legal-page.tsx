import Link from "next/link";

import { ProductLogo } from "@/components/product-logo";

type LegalSection = {
  title: string;
  content: React.ReactNode;
};

export function LegalPage({
  eyebrow,
  title,
  summary,
  sections,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-paper font-landing text-ink antialiased">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" aria-label="Tape home">
            <ProductLogo />
          </Link>
          <nav
            aria-label="Legal"
            className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.2em] text-ash"
          >
            <Link className="transition-colors hover:text-ink" href="/privacy">
              Privacy
            </Link>
            <Link className="transition-colors hover:text-ink" href="/terms">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-14 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-24 lg:py-24">
        <div className="lg:sticky lg:top-12 lg:self-start">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-brand">
            {eyebrow}
          </p>
          <h1 className="font-display mt-5 text-5xl leading-[1.02] tracking-tight sm:text-6xl">
            {title}
          </h1>
          <p className="mt-7 max-w-md text-base leading-7 text-ash">
            {summary}
          </p>
          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">
            Effective July 24, 2026
          </p>
        </div>

        <article className="min-w-0 divide-y divide-ink/10 border-y border-ink/10">
          {sections.map((section, index) => (
            <section className="py-8 sm:py-10" key={section.title}>
              <div className="grid gap-4 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-6">
                <p
                  aria-hidden
                  className="font-mono text-[10px] tracking-[0.18em] text-brand"
                >
                  {String(index + 1).padStart(2, "0")}
                </p>
                <div>
                  <h2 className="font-display text-2xl leading-tight tracking-tight">
                    {section.title}
                  </h2>
                  <div className="mt-4 space-y-4 text-[15px] leading-7 text-ash [&_a]:text-ink [&_a]:underline [&_a]:decoration-ink/25 [&_a]:underline-offset-4 [&_a:hover]:decoration-ink">
                    {section.content}
                  </div>
                </div>
              </div>
            </section>
          ))}
        </article>
      </div>

      <footer className="border-t border-ink/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 font-mono text-[10px] uppercase tracking-[0.2em] text-ash sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>© 2026 Tape</p>
          <Link className="transition-colors hover:text-ink" href="/">
            Return home
          </Link>
        </div>
      </footer>
    </main>
  );
}
