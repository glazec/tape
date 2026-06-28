import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { CalendarAutomationPanel } from "@/components/calendar-automation-panel";
import { DashboardWorkflowSummary } from "@/components/dashboard-workflow-summary";
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
import {
  getMeetingDashboardSummaryForWorkspace,
  listMeetingLibraryPageForWorkspace,
} from "@/lib/meeting-queries";
import { cn } from "@/lib/utils";
import {
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[];
    q?: string | string[];
    syncCalendar?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const { page, q, syncCalendar } = await searchParams;
  const currentPage = parseMeetingLibraryPage(page);
  const query = getSearchParamValue(q);
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);
  const [meetingLibraryPage, dashboardSummary, calendarStatus] =
    await Promise.all([
      listMeetingLibraryPageForWorkspace(workspace, {
        page: currentPage,
        query,
      }),
      accessSummary.canCreateMeetings
        ? getMeetingDashboardSummaryForWorkspace(workspace)
        : Promise.resolve(null),
      accessSummary.canCreateMeetings
        ? getCalendarConnectionSummaryForWorkspace(workspace)
        : Promise.resolve(null),
    ]);

  return (
    <AppShell
      activeHref="/dashboard"
      canCreateMeetings={accessSummary.canCreateMeetings}
      oneSignalExternalId={workspace.userId}
    >
      <section className="flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem_18rem] md:items-start xl:grid-cols-[1fr_22rem_22rem]">
          <div>
            <p className="text-sm font-medium uppercase tracking-normal text-primary">
              Dashboard
            </p>
            <h1 className="mt-3 text-3xl font-semibold">
              {accessSummary.isSharedOnly ? "Shared transcripts" : "Meeting hub"}
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              {accessSummary.isSharedOnly
                ? "Open transcripts that teammates shared with you."
                : "Track founder calls, IC discussions, and team syncs from calendar invite to reviewed transcript."}
            </p>
          </div>
          {calendarStatus ? (
            <CalendarAutomationPanel
              accountLabel={user.email}
              autoSync={getSearchParamValue(syncCalendar) === "1"}
              nextJoinTitle={dashboardSummary?.nextBotJoin?.title ?? null}
              status={calendarStatus}
            />
          ) : null}
          {dashboardSummary ? (
            <DashboardWorkflowSummary summary={dashboardSummary} />
          ) : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Meeting library</CardTitle>
            <CardDescription>
              {accessSummary.isSharedOnly
                ? "Transcripts shared with your account."
                : "Recent transcripts, scheduled joins, and recordings that need review."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <form className="max-w-xl">
              <Label htmlFor="meeting-search" className="sr-only">
                Search meetings
              </Label>
              <div className="mt-2 flex items-center gap-2">
                <Search
                  className="text-muted-foreground"
                  data-icon="inline-start"
                />
                <Input
                  id="meeting-search"
                  name="q"
                  type="search"
                  defaultValue={query ?? ""}
                  placeholder={
                    accessSummary.isSharedOnly
                      ? "Search shared transcript"
                      : "Search company, founder, speaker, or transcript"
                  }
                />
              </div>
            </form>

            <MeetingList
              emptyMessage={
                accessSummary.isSharedOnly
                  ? "No transcripts have been shared with you yet"
                  : "No meetings found"
              }
              meetings={meetingLibraryPage.meetings}
            />
            <MeetingLibraryPagination
              hasNextPage={meetingLibraryPage.hasNextPage}
              hasPreviousPage={meetingLibraryPage.hasPreviousPage}
              nextHref={buildDashboardPageHref({
                page: meetingLibraryPage.page + 1,
                q: query,
                syncCalendar,
              })}
              page={meetingLibraryPage.page}
              previousHref={buildDashboardPageHref({
                page: meetingLibraryPage.page - 1,
                q: query,
                syncCalendar,
              })}
            />
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function MeetingLibraryPagination({
  hasNextPage,
  hasPreviousPage,
  nextHref,
  page,
  previousHref,
}: {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextHref: string;
  page: number;
  previousHref: string;
}) {
  if (!hasNextPage && !hasPreviousPage) {
    return null;
  }

  return (
    <nav
      aria-label="Meeting library pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <span className="text-sm text-muted-foreground">Page {page}</span>
      <div className="flex items-center gap-2">
        {hasPreviousPage ? (
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href={previousHref}
          >
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "pointer-events-none opacity-50",
            )}
          >
            <ChevronLeft data-icon="inline-start" />
            Previous
          </span>
        )}
        {hasNextPage ? (
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href={nextHref}
          >
            Next
            <ChevronRight data-icon="inline-end" />
          </Link>
        ) : (
          <span
            aria-disabled="true"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "pointer-events-none opacity-50",
            )}
          >
            Next
            <ChevronRight data-icon="inline-end" />
          </span>
        )}
      </div>
    </nav>
  );
}

function parseMeetingLibraryPage(value: string | string[] | undefined) {
  const numberValue = Number(getSearchParamValue(value));

  if (!Number.isInteger(numberValue) || numberValue < 1) {
    return 1;
  }

  return numberValue;
}

function buildDashboardPageHref({
  page,
  q,
  syncCalendar,
}: {
  page: number;
  q?: string;
  syncCalendar?: string | string[];
}) {
  const params = new URLSearchParams();
  const syncCalendarValue = getSearchParamValue(syncCalendar);

  if (q) {
    params.set("q", q);
  }

  if (syncCalendarValue) {
    params.set("syncCalendar", syncCalendarValue);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();

  return query ? `/dashboard?${query}` : "/dashboard";
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
