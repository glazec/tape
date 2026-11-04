"use client";
export default function IntelError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl px-6 py-20"><h1 className="text-2xl font-medium">Intel could not load</h1><p className="mt-3 text-sm text-muted-foreground">Your meetings are still available. Try loading Intel again.</p><button onClick={reset} className="mt-5 rounded-lg border px-4 py-2 text-sm">Try again</button></main>;
}
