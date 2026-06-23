import { notFound } from "next/navigation";

import { TranscriptViewer } from "@/components/transcript-viewer";
import { getSharedTranscriptByToken } from "@/lib/share-links";

export const dynamic = "force-dynamic";

export default async function SharedTranscriptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const sharedTranscript = await getSharedTranscriptByToken(token);

  if (!sharedTranscript) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 sm:py-10">
      <section className="mx-auto w-full max-w-4xl min-w-0">
        <p className="text-sm font-medium uppercase tracking-normal text-primary">
          Shared transcript
        </p>
        <h1 className="mt-3 break-words text-3xl font-semibold">
          {sharedTranscript.title}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
          Read only transcript link.
        </p>
        <div className="mt-8">
          <TranscriptViewer segments={sharedTranscript.segments} />
        </div>
      </section>
    </main>
  );
}
