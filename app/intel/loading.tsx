import { AppShell } from "@/components/app-shell";

// Render the real shell so the header stays put while the page streams in.
export default function IntelLoading() {
  return (
    <AppShell activeHref="/intel">
      <p role="status" className="text-sm text-muted-foreground">Loading Intel…</p>
    </AppShell>
  );
}
