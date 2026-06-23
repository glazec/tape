import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/auth";

export default async function TeamSettingsPage() {
  const user = await getCurrentUser();

  return (
    <AppShell>
      <section className="max-w-3xl">
        <p className="text-sm font-medium uppercase tracking-normal text-[var(--primary)]">
          Team settings
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Access rules</h1>
        <p className="mt-4 text-base leading-7 text-[var(--muted)]">
          Signed in as {user?.email ?? "unknown user"}.
        </p>
        <div className="mt-8 border-t border-[var(--border)] pt-8">
          <h2 className="text-xl font-semibold">Internal domains</h2>
          <p className="mt-3 leading-7 text-[var(--muted)]">
            Allowed internal domains define which meeting attendees can receive
            automatic transcript access. When a meeting is processed, attendees
            with an allowed domain and matching workspace membership can be
            granted access without a manual share step.
          </p>
        </div>
      </section>
    </AppShell>
  );
}
