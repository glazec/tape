import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { MeetingList, type MeetingListItem } from "@/components/meeting-list";
import { requireCurrentUser } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

const meetings: MeetingListItem[] = [
  {
    id: "weekly-product-review",
    title: "Weekly product review",
    platform: "google_meet",
    startedAt: "2026-06-22T14:00:00.000Z",
    status: "ready",
  },
  {
    id: "pipeline-sync",
    title: "Pipeline sync",
    platform: "zoom",
    startedAt: "2026-06-23T16:30:00.000Z",
    status: "processing",
  },
  {
    id: "customer-call-upload",
    title: "Customer call upload",
    platform: "upload",
    startedAt: "2026-06-20T18:15:00.000Z",
    status: "ready",
  },
  {
    id: "design-critique",
    title: "Design critique",
    platform: "google_meet",
    startedAt: "2026-06-24T15:00:00.000Z",
    status: "scheduled",
  },
];

export default async function DashboardPage() {
  await requireCurrentUser();

  return (
    <AppShell>
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-normal text-[var(--primary)]">
              Dashboard
            </p>
            <h1 className="mt-3 text-3xl font-semibold">
              Transcript workspace
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
              Search recent meetings, review processing state, and open ready
              transcripts.
            </p>
          </div>
          <Link
            href="/meetings/new"
            className="inline-flex w-fit rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Record
          </Link>
        </div>

        <form className="max-w-xl">
          <label htmlFor="meeting-search" className="text-sm font-medium">
            Search transcripts
          </label>
          <input
            id="meeting-search"
            name="q"
            type="search"
            placeholder="Search title, speaker, or transcript"
            className="mt-2 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--primary)]"
          />
        </form>

        <MeetingList meetings={meetings} />
      </section>
    </AppShell>
  );
}
