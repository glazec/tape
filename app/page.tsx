export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-16 text-[var(--text)]">
      <section className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-4xl flex-col justify-center gap-10">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-normal text-[var(--primary)]">
            Meeting Transcript
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-6xl">
            Sign in to your team transcript workspace.
          </h1>
          <p className="mt-6 text-lg leading-8 text-[var(--muted)]">
            Keep meeting recordings, transcripts, and internal attendee access
            tied to the right workspace.
          </p>
          <a
            href="/api/auth/signin/google"
            className="mt-8 inline-flex rounded-md bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-white"
          >
            Sign in with Google
          </a>
        </div>

        <div className="grid gap-4 border-t border-[var(--border)] pt-8 sm:grid-cols-2">
          <div>
            <h2 className="text-base font-semibold">Team workspace</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Review transcripts with access based on workspace membership.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold">Internal access</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Grant known internal attendees access automatically after
              meetings are processed.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
