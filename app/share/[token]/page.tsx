import {
  TranscriptViewer,
  type TranscriptSegment,
} from "@/components/transcript-viewer";

const sharedTranscript: TranscriptSegment[] = [
  {
    id: "share-1",
    speaker: "Maya",
    startMs: 0,
    text: "This shared transcript view is read only and exposes only the meeting content attached to the link.",
  },
  {
    id: "share-2",
    speaker: "Jon",
    startMs: 19600,
    text: "The link should expire automatically and remain revocable from the meeting workspace.",
  },
  {
    id: "share-3",
    speaker: "Priya",
    startMs: 45100,
    text: "No workspace navigation is shown here because external viewers should stay focused on the transcript.",
  },
];

export default async function SharedTranscriptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <main className="min-h-screen bg-[var(--background)] px-6 py-10 text-[var(--text)]">
      <section className="mx-auto w-full max-w-4xl">
        <p className="text-sm font-medium uppercase tracking-normal text-[var(--primary)]">
          Shared transcript
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Weekly product review</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
          Read only transcript link. Token: {token}
        </p>
        <div className="mt-8">
          <TranscriptViewer segments={sharedTranscript} />
        </div>
      </section>
    </main>
  );
}
