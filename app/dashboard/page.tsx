import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Star } from "lucide-react";

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
  defaultMeetingLibraryViewConfig,
  meetingLibrarySearchScopeLabels,
  meetingLibrarySearchScopes,
  meetingLibrarySortLabels,
  meetingLibrarySorts,
  meetingLibraryStatusFilters,
  meetingLibraryStatusLabels,
  normalizeMeetingLibraryViewConfig,
  type MeetingLibrarySort,
  type MeetingLibraryViewConfig,
} from "@/lib/meeting-library-view-options";
import { getDefaultMeetingLibraryView } from "@/lib/meeting-library-views";
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
    scope?: string | string[];
    sort?: string | string[];
    status?: string | string[];
    syncCalendar?: string | string[];
    view?: string | string[];
  }>;
}) {
  const user = await requireCurrentUser();
  const { page, q, scope, sort, status, syncCalendar, view } =
    await searchParams;
  const currentPage = parseMeetingLibraryPage(page);
  const requestedViewConfig = normalizeMeetingLibraryViewConfig({
    q,
    scope,
    status,
    sort,
  });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const accessSummary = await getWorkspaceAccessSummary(workspace);
  const savedViewConfig = await getDefaultMeetingLibraryView(workspace);
  const activeViewConfig =
    shouldUseSavedMeetingLibraryView({ q, scope, sort, status, view }) &&
    savedViewConfig
      ? savedViewConfig
      : requestedViewConfig;
  const query = activeViewConfig.query ?? undefined;
  const [meetingLibraryPage, dashboardSummary, calendarStatus] =
    await Promise.all([
      listMeetingLibraryPageForWorkspace(workspace, {
        page: currentPage,
        query,
        searchScope: activeViewConfig.searchScope,
        sort: activeViewConfig.sort,
        status: activeViewConfig.status,
      }),
      accessSummary.canCreateMeetings
        ? getMeetingDashboardSummaryForWorkspace(workspace, {
            userEmail: user.email,
            userName: user.name,
          })
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
            <MeetingLibraryViewBar
              activeViewConfig={activeViewConfig}
              hasSavedView={Boolean(savedViewConfig)}
              syncCalendar={syncCalendar}
            />
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <MeetingLibraryControls
                activeViewConfig={activeViewConfig}
                isSharedOnly={accessSummary.isSharedOnly}
                syncCalendar={syncCalendar}
              />
            </div>

            <MeetingList
              emptyMessage={
                accessSummary.isSharedOnly
                  ? "No transcripts have been shared with you yet"
                  : "No meetings found"
              }
              meetings={meetingLibraryPage.meetings}
              sort={activeViewConfig.sort}
              sortLinks={getMeetingLibrarySortLinks({
                activeViewConfig,
                syncCalendar,
              })}
            />
            <MeetingLibraryPagination
              hasNextPage={meetingLibraryPage.hasNextPage}
              hasPreviousPage={meetingLibraryPage.hasPreviousPage}
              nextHref={buildDashboardPageHref({
                ...activeViewConfig,
                page: meetingLibraryPage.page + 1,
                syncCalendar,
              })}
              page={meetingLibraryPage.page}
              previousHref={buildDashboardPageHref({
                ...activeViewConfig,
                page: meetingLibraryPage.page - 1,
                syncCalendar,
              })}
            />
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function MeetingLibraryViewBar({
  activeViewConfig,
  hasSavedView,
  syncCalendar,
}: {
  activeViewConfig: MeetingLibraryViewConfig;
  hasSavedView: boolean;
  syncCalendar?: string | string[];
}) {
  const presets: Array<{
    href: string;
    label: string;
  }> = [
    {
      href: buildDashboardPageHref({
        ...defaultMeetingLibraryViewConfig,
        syncCalendar,
        view: "all",
      }),
      label: "All meetings",
    },
    {
      href: buildDashboardPageHref({
        ...defaultMeetingLibraryViewConfig,
        status: "ready",
        syncCalendar,
      }),
      label: "Ready",
    },
    {
      href: buildDashboardPageHref({
        ...defaultMeetingLibraryViewConfig,
        status: "in_progress",
        syncCalendar,
      }),
      label: "In progress",
    },
    {
      href: buildDashboardPageHref({
        ...activeViewConfig,
        sort: "duration_desc",
        syncCalendar,
      }),
      label: "Long meetings",
    },
    {
      href: buildDashboardPageHref({
        ...activeViewConfig,
        sort: "participants_desc",
        syncCalendar,
      }),
      label: "Most people",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {hasSavedView ? (
        <Link
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
          href={buildDashboardPageHref({
            ...defaultMeetingLibraryViewConfig,
            syncCalendar,
            view: "my",
          })}
        >
          <Star data-icon="inline-start" />
          My view
        </Link>
      ) : null}
      {presets.map((preset) => (
        <Link
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          href={preset.href}
          key={preset.label}
        >
          {preset.label}
        </Link>
      ))}
    </div>
  );
}

function MeetingLibraryControls({
  activeViewConfig,
  isSharedOnly,
  syncCalendar,
}: {
  activeViewConfig: MeetingLibraryViewConfig;
  isSharedOnly: boolean;
  syncCalendar?: string | string[];
}) {
  const syncCalendarValue = getSearchParamValue(syncCalendar);

  return (
    <form className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_10rem_10rem_12rem_auto] md:items-end">
      {syncCalendarValue ? (
        <input name="syncCalendar" type="hidden" value={syncCalendarValue} />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="meeting-search" className="sr-only">
          Search meetings
        </Label>
        <div className="flex items-center gap-2">
          <Search className="text-muted-foreground" data-icon="inline-start" />
          <Input
            id="meeting-search"
            name="q"
            type="search"
            defaultValue={activeViewConfig.query ?? ""}
            placeholder={
              isSharedOnly
                ? "Search shared transcript"
                : "Search company, founder, speaker, or transcript"
            }
          />
        </div>
      </div>
      <SelectField
        id="meeting-search-scope"
        label="Search in"
        name="scope"
        options={meetingLibrarySearchScopes.map((value) => ({
          label: meetingLibrarySearchScopeLabels[value],
          value,
        }))}
        value={activeViewConfig.searchScope}
      />
      <SelectField
        id="meeting-status"
        label="Status"
        name="status"
        options={meetingLibraryStatusFilters.map((value) => ({
          label: meetingLibraryStatusLabels[value],
          value,
        }))}
        value={activeViewConfig.status}
      />
      <SelectField
        id="meeting-sort"
        label="Sort"
        name="sort"
        options={meetingLibrarySorts.map((value) => ({
          label: meetingLibrarySortLabels[value],
          value,
        }))}
        value={activeViewConfig.sort}
      />
      <button className={cn(buttonVariants())} type="submit">
        Apply
      </button>
    </form>
  );
}

function SelectField({
  id,
  label,
  name,
  options,
  value,
}: {
  id: string;
  label: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        defaultValue={value}
        id={id}
        name={name}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
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
  query,
  searchScope,
  sort,
  status,
  syncCalendar,
  view,
}: {
  page?: number;
  query?: string | null;
  searchScope?: MeetingLibraryViewConfig["searchScope"];
  sort?: MeetingLibrarySort;
  status?: MeetingLibraryViewConfig["status"];
  syncCalendar?: string | string[];
  view?: "all" | "my";
}) {
  const params = new URLSearchParams();
  const syncCalendarValue = getSearchParamValue(syncCalendar);

  if (query) {
    params.set("q", query);
  }

  if (
    searchScope &&
    searchScope !== defaultMeetingLibraryViewConfig.searchScope
  ) {
    params.set("scope", searchScope);
  }

  if (status && status !== defaultMeetingLibraryViewConfig.status) {
    params.set("status", status);
  }

  if (sort && sort !== defaultMeetingLibraryViewConfig.sort) {
    params.set("sort", sort);
  }

  if (syncCalendarValue) {
    params.set("syncCalendar", syncCalendarValue);
  }

  if (view) {
    params.set("view", view);
  }

  if (page && page > 1) {
    params.set("page", String(page));
  }

  const queryString = params.toString();

  return queryString ? `/dashboard?${queryString}` : "/dashboard";
}

function getMeetingLibrarySortLinks({
  activeViewConfig,
  syncCalendar,
}: {
  activeViewConfig: MeetingLibraryViewConfig;
  syncCalendar?: string | string[];
}) {
  return {
    title: buildDashboardPageHref({
      ...activeViewConfig,
      sort: getNextSort(activeViewConfig.sort, "title_asc", "title_desc"),
      syncCalendar,
    }),
    participantCount: buildDashboardPageHref({
      ...activeViewConfig,
      sort: getNextSort(
        activeViewConfig.sort,
        "participants_desc",
        "participants_asc",
      ),
      syncCalendar,
    }),
    duration: buildDashboardPageHref({
      ...activeViewConfig,
      sort: getNextSort(
        activeViewConfig.sort,
        "duration_desc",
        "duration_asc",
      ),
      syncCalendar,
    }),
    startedAt: buildDashboardPageHref({
      ...activeViewConfig,
      sort: getNextSort(activeViewConfig.sort, "time_desc", "time_asc"),
      syncCalendar,
    }),
  };
}

function getNextSort(
  currentSort: MeetingLibrarySort,
  defaultSort: MeetingLibrarySort,
  alternateSort: MeetingLibrarySort,
) {
  return currentSort === defaultSort ? alternateSort : defaultSort;
}

function shouldUseSavedMeetingLibraryView({
  q,
  scope,
  sort,
  status,
  view,
}: {
  q?: string | string[];
  scope?: string | string[];
  sort?: string | string[];
  status?: string | string[];
  view?: string | string[];
}) {
  const viewValue = getSearchParamValue(view);

  if (viewValue === "all") {
    return false;
  }

  if (viewValue === "my") {
    return true;
  }

  return !(
    getSearchParamValue(q) ||
    getSearchParamValue(scope) ||
    getSearchParamValue(sort) ||
    getSearchParamValue(status)
  );
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
