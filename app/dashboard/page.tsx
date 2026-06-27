import Link from "next/link";
import { Plus, Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { CalendarAutomationPanel } from "@/components/calendar-automation-panel";
import { MeetingList } from "@/components/meeting-list";
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
import { getCalendarConnectionSummaryForWorkspace } from "@/lib/calendar-connection-queries";
import { listMeetingsForWorkspace } from "@/lib/meeting-queries";
import { cn } from "@/lib/utils";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; syncCalendar?: string }>;
}) {
  const user = await requireCurrentUser();
  const { q, syncCalendar } = await searchParams;
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const [meetings, calendarStatus] = await Promise.all([
    listMeetingsForWorkspace(workspace, q),
    getCalendarConnectionSummaryForWorkspace(workspace),
  ]);

  return (
    <AppShell activeHref="/dashboard">
      <section className="flex flex-col gap-6">
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
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
            <Link
              href="/meetings/new"
              className={cn(buttonVariants(), "mt-5 w-fit")}
            >
              <Plus data-icon="inline-start" />
              Record
            </Link>
          </div>
          <CalendarAutomationPanel
            autoSync={syncCalendar === "1"}
            status={calendarStatus}
          />
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
                  defaultValue={q ?? ""}
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
