export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-16 text-[var(--text)]">
      <section className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-5xl flex-col justify-center gap-10">
        <div className="max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-normal text-[var(--primary)]">
            Meeting Transcript
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-6xl">
            Team meeting transcripts with searchable context.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">
            Record Google Meet and Zoom calls, upload audio, transcribe with
            ElevenLabs, and keep transcript access tied to team membership.
          </p>
        </div>

        <div className="grid gap-4 border-t border-[var(--border)] pt-8 sm:grid-cols-3">
          <div>
            <h2 className="text-base font-semibold">Capture</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Schedule Recall.ai bots or start a manual recording from a
              meeting link.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold">Transcribe</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Store media in Cloudflare R2 and process audio through
              ElevenLabs.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold">Share</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Grant internal access automatically and use explicit links for
              external viewers.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
