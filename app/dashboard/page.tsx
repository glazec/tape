import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { MeetingList, type MeetingListItem } from "@/components/meeting-list";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireCurrentUser } from "@/lib/auth-guards";
import { cn } from "@/lib/utils";

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
            <p className="text-sm font-medium uppercase tracking-normal text-primary">
              Dashboard
            </p>
            <h1 className="mt-3 text-3xl font-semibold">
              Transcript workspace
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Search recent meetings, review processing state, and open ready
              transcripts.
            </p>
          </div>
          <Link href="/meetings/new" className={cn(buttonVariants(), "w-fit")}>
            <Plus data-icon="inline-start" />
            Record
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Meetings</CardTitle>
            <CardDescription>
              Ready transcripts, queued uploads, and scheduled bots.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="max-w-xl">
              <Label htmlFor="meeting-search">Search transcripts</Label>
              <div className="mt-2 flex items-center gap-2">
                <Search
                  className="text-muted-foreground"
                  data-icon="inline-start"
                />
                <Input
                  id="meeting-search"
                  name="q"
                  type="search"
                  placeholder="Search title, speaker, or transcript"
                />
              </div>
            </form>

            <MeetingList meetings={meetings} />
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
