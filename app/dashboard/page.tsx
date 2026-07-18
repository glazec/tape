import Link from "next/link";
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Search,
  Star,
} from "lucide-react";

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
  DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS,
  DEFAULT_RELATED_MEETING_HISTORY_MONTHS,
  MAX_MEETING_LIBRARY_HISTORY_MONTHS,
  MEETING_LIBRARY_HISTORY_MONTH_STEP,
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
    historyMonths?: string | string[];
    q?: string | string[];
    relatedMonths?: string | string[];
    scope?: string | string[];
    sort?: string | string[];
    status?: string | string[];
    syncCalendar?: string | string[];
    view?: string | string[];
  }>;
}) {
  const [user, resolvedSearchParams] = await Promise.all([
    requireCurrentUser(),
    searchParams,
  ]);
  const {
    page,
    historyMonths: historyMonthsParam,
    q,
    relatedMonths,
    scope,
    sort,
    status,
    syncCalendar,
    view,
  } = resolvedSearchParams;
  const currentPage = parseMeetingLibraryPage(page);
  const historyMonths = parseMeetingLibraryHistoryMonths(historyMonthsParam);
  const relatedHistoryMonths = parseRelatedMeetingHistoryMonths(relatedMonths);
  const requestedViewConfig = normalizeMeetingLibraryViewConfig({
    q,
    scope,
    status,
    sort,
  });
  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const [accessSummary, savedViewConfig] = await Promise.all([
    getWorkspaceAccessSummary(workspace),
    getDefaultMeetingLibraryView(workspace),
  ]);
  const activeViewConfig =
    shouldUseSavedMeetingLibraryView({ q, scope, sort, status, view }) &&
    savedViewConfig
      ? savedViewConfig
      : requestedViewConfig;
  const query = activeViewConfig.query ?? undefined;
  const [meetingLibraryPage, dashboardSummary, calendarStatus] =
    await Promise.all([
      listMeetingLibraryPageForWorkspace(workspace, {
        historyMonths,
        page: currentPage,
        query,
        relatedHistoryMonths,
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
        {accessSummary.isSharedOnly ? (
          <Card>
            <CardHeader>
              <CardTitle>Shared transcripts</CardTitle>
              <CardDescription>
                Open transcripts that teammates shared with you.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <DashboardGreetingCard
              meetingCount={dashboardSummary?.userStats.last7DaysMeetings ?? 0}
              name={getDashboardFirstName(user.name, user.email)}
              needsAttention={dashboardSummary?.needsAttention ?? 0}
            />
            {dashboardSummary ? (
              <DashboardWorkflowSummary summary={dashboardSummary} />
            ) : null}
            {calendarStatus ? (
              <CalendarAutomationPanel
                accountLabel={user.email}
                autoSync={getSearchParamValue(syncCalendar) === "1"}
                nextJoinTitle={dashboardSummary?.nextBotJoin?.title ?? null}
                status={calendarStatus}
              />
            ) : null}
          </div>
        )}

        <Card className="gap-0 py-0 shadow-sm">
          <CardHeader className="border-b bg-muted/25 px-4 py-4 sm:px-5">
            <CardTitle>Meeting library</CardTitle>
            <CardDescription>
              {accessSummary.isSharedOnly
                ? "Transcripts shared with your account."
                : "Recent transcripts, scheduled joins, and recordings that need review."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col px-0">
            <div className="border-b px-4 py-3 sm:px-5">
              <MeetingLibraryViewBar
                activeViewConfig={activeViewConfig}
                historyMonths={meetingLibraryPage.historyMonths}
                hasSavedView={Boolean(savedViewConfig)}
                relatedHistoryMonths={meetingLibraryPage.relatedHistoryMonths}
                syncCalendar={syncCalendar}
              />
            </div>
            <MeetingLibraryControls
              activeViewConfig={activeViewConfig}
              historyMonths={meetingLibraryPage.historyMonths}
              isSharedOnly={accessSummary.isSharedOnly}
              relatedHistoryMonths={meetingLibraryPage.relatedHistoryMonths}
              syncCalendar={syncCalendar}
            />

            <MeetingList
              emptyMessage={
                accessSummary.isSharedOnly
                  ? "No transcripts have been shared with you yet"
                  : "No meetings found"
              }
              meetings={withRelatedHistoryLinks(meetingLibraryPage.meetings, {
                activeViewConfig,
                historyMonths: meetingLibraryPage.historyMonths,
                relatedHistoryMonths: meetingLibraryPage.relatedHistoryMonths,
                syncCalendar,
              })}
              sort={activeViewConfig.sort}
              sortLinks={getMeetingLibrarySortLinks({
                activeViewConfig,
                historyMonths: meetingLibraryPage.historyMonths,
                relatedHistoryMonths: meetingLibraryPage.relatedHistoryMonths,
                syncCalendar,
              })}
            />
            <MeetingLibraryPagination
              className="border-t px-4 py-3 sm:px-5"
              hasNextPage={meetingLibraryPage.hasNextPage}
              hasOlderMeetings={meetingLibraryPage.hasOlderMeetings}
              hasPreviousPage={meetingLibraryPage.hasPreviousPage}
              historyHref={buildDashboardPageHref({
                ...activeViewConfig,
                historyMonths: getNextHistoryMonths(
                  meetingLibraryPage.historyMonths,
                ),
                relatedHistoryMonths: Math.max(
                  meetingLibraryPage.relatedHistoryMonths,
                  getNextHistoryMonths(meetingLibraryPage.historyMonths),
                ),
                syncCalendar,
              })}
              historyMonths={meetingLibraryPage.historyMonths}
              nextHref={buildDashboardPageHref({
                ...activeViewConfig,
                historyMonths: meetingLibraryPage.historyMonths,
                page: meetingLibraryPage.page + 1,
                relatedHistoryMonths: meetingLibraryPage.relatedHistoryMonths,
                syncCalendar,
              })}
              page={meetingLibraryPage.page}
              previousHref={buildDashboardPageHref({
                ...activeViewConfig,
                historyMonths: meetingLibraryPage.historyMonths,
                page: meetingLibraryPage.page - 1,
                relatedHistoryMonths: meetingLibraryPage.relatedHistoryMonths,
                syncCalendar,
              })}
              resetHistoryHref={buildDashboardPageHref({
                ...activeViewConfig,
                syncCalendar,
              })}
            />
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}

function DashboardGreetingCard({
  meetingCount,
  name,
  needsAttention,
}: {
  meetingCount: number;
  name: string;
  needsAttention: number;
}) {
  return (
    <Card className="relative min-h-72 overflow-hidden bg-[radial-gradient(circle_at_top_right,color-mix(in_oklch,var(--primary)_12%,transparent),transparent_42%)] lg:row-span-2">
      <CardContent className="flex flex-1 flex-col justify-center py-8 sm:px-8">
        <div className="relative z-10 max-w-md">
          <p className="text-sm font-medium text-primary">Dashboard</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Welcome back, {name}.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {formatGreetingSummary(meetingCount, needsAttention)}
          </p>
        </div>
        <CalendarCheck2 className="absolute right-8 bottom-8 size-24 text-primary/10 sm:size-32" />
      </CardContent>
    </Card>
  );
}

function getDashboardFirstName(name: string | null, email: string) {
  const firstName = name?.trim().split(/\s+/)[0];

  if (firstName) {
    return firstName;
  }

  return email.split("@")[0] || "there";
}

function formatGreetingSummary(meetingCount: number, needsAttention: number) {
  const meetingSummary =
    meetingCount === 1
      ? "You had 1 meeting in the last 7 days."
      : `You had ${meetingCount.toLocaleString()} meetings in the last 7 days.`;

  if (needsAttention === 0) {
    return `${meetingSummary} Everything is on track.`;
  }

  const attentionSummary =
    needsAttention === 1
      ? "One needs your attention."
      : `${needsAttention.toLocaleString()} need your attention.`;

  return `${meetingSummary} ${attentionSummary}`;
}

function MeetingLibraryViewBar({
  activeViewConfig,
  historyMonths,
  hasSavedView,
  relatedHistoryMonths,
  syncCalendar,
}: {
  activeViewConfig: MeetingLibraryViewConfig;
  historyMonths: number;
  hasSavedView: boolean;
  relatedHistoryMonths: number;
  syncCalendar?: string | string[];
}) {
  const presets: Array<{
    href: string;
    label: string;
  }> = [
    {
      href: buildDashboardPageHref({
        ...defaultMeetingLibraryViewConfig,
        historyMonths,
        relatedHistoryMonths,
        syncCalendar,
        view: "all",
      }),
      label: "All meetings",
    },
    {
      href: buildDashboardPageHref({
        ...defaultMeetingLibraryViewConfig,
        historyMonths,
        relatedHistoryMonths,
        status: "ready",
        syncCalendar,
      }),
      label: "Ready",
    },
    {
      href: buildDashboardPageHref({
        ...defaultMeetingLibraryViewConfig,
        historyMonths,
        relatedHistoryMonths,
        status: "in_progress",
        syncCalendar,
      }),
      label: "In progress",
    },
    {
      href: buildDashboardPageHref({
        ...activeViewConfig,
        historyMonths,
        relatedHistoryMonths,
        sort: "duration_desc",
        syncCalendar,
      }),
      label: "Long meetings",
    },
    {
      href: buildDashboardPageHref({
        ...activeViewConfig,
        historyMonths,
        relatedHistoryMonths,
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
            historyMonths,
            relatedHistoryMonths,
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
  historyMonths,
  isSharedOnly,
  relatedHistoryMonths,
  syncCalendar,
}: {
  activeViewConfig: MeetingLibraryViewConfig;
  historyMonths: number;
  isSharedOnly: boolean;
  relatedHistoryMonths: number;
  syncCalendar?: string | string[];
}) {
  const syncCalendarValue = getSearchParamValue(syncCalendar);

  return (
    <form className="grid gap-3 border-b bg-muted/20 px-4 py-3 sm:px-5 md:grid-cols-[minmax(12rem,1fr)_10rem_10rem_12rem_auto] md:items-end">
      {syncCalendarValue ? (
        <input name="syncCalendar" type="hidden" value={syncCalendarValue} />
      ) : null}
      {historyMonths > DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS ? (
        <input name="historyMonths" type="hidden" value={historyMonths} />
      ) : null}
      {relatedHistoryMonths > historyMonths ? (
        <input
          name="relatedMonths"
          type="hidden"
          value={relatedHistoryMonths}
        />
      ) : null}
      <div className="min-w-0 space-y-2">
        <Label htmlFor="meeting-search" className="sr-only">
          Search meetings
        </Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="meeting-search"
            name="q"
            type="search"
            defaultValue={activeViewConfig.query ?? ""}
            className="bg-background pl-8"
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
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
  className,
  hasNextPage,
  hasOlderMeetings,
  hasPreviousPage,
  historyHref,
  historyMonths,
  nextHref,
  page,
  previousHref,
  resetHistoryHref,
}: {
  className?: string;
  hasNextPage: boolean;
  hasOlderMeetings: boolean;
  hasPreviousPage: boolean;
  historyHref: string;
  historyMonths: number;
  nextHref: string;
  page: number;
  previousHref: string;
  resetHistoryHref: string;
}) {
  if (
    !hasNextPage &&
    !hasPreviousPage &&
    !hasOlderMeetings &&
    historyMonths === DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS
  ) {
    return null;
  }

  return (
    <nav
      aria-label="Meeting library pages"
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <span className="text-sm text-muted-foreground">
        Showing last {historyMonths} months{page > 1 ? `, page ${page}` : ""}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {hasPreviousPage ? (
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href={previousHref}
          >
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Link>
        ) : historyMonths > DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS ? (
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href={resetHistoryHref}
          >
            <ChevronLeft data-icon="inline-start" />
            Last 6 months
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
            Load more meetings
            <ChevronRight data-icon="inline-end" />
          </Link>
        ) : hasOlderMeetings ? (
          <Link
            className={cn(buttonVariants({ variant: "outline" }))}
            href={historyHref}
          >
            Load older history
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
            No more in this view
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

function parseMeetingLibraryHistoryMonths(value: string | string[] | undefined) {
  const numberValue = Number(getSearchParamValue(value));

  if (!Number.isInteger(numberValue)) {
    return DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS;
  }

  return Math.max(
    DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS,
    Math.min(MAX_MEETING_LIBRARY_HISTORY_MONTHS, numberValue),
  );
}

function parseRelatedMeetingHistoryMonths(value: string | string[] | undefined) {
  const numberValue = Number(getSearchParamValue(value));

  if (!Number.isInteger(numberValue)) {
    return DEFAULT_RELATED_MEETING_HISTORY_MONTHS;
  }

  return Math.max(
    DEFAULT_RELATED_MEETING_HISTORY_MONTHS,
    Math.min(MAX_MEETING_LIBRARY_HISTORY_MONTHS, numberValue),
  );
}

function buildDashboardPageHref({
  page,
  query,
  historyMonths,
  relatedHistoryMonths,
  searchScope,
  sort,
  status,
  syncCalendar,
  view,
}: {
  page?: number;
  query?: string | null;
  historyMonths?: number;
  relatedHistoryMonths?: number;
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

  if (
    historyMonths &&
    historyMonths > DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS
  ) {
    params.set("historyMonths", String(historyMonths));
  }

  if (relatedHistoryMonths && relatedHistoryMonths > (historyMonths ?? DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS)) {
    params.set("relatedMonths", String(relatedHistoryMonths));
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
  historyMonths,
  relatedHistoryMonths,
  syncCalendar,
}: {
  activeViewConfig: MeetingLibraryViewConfig;
  historyMonths: number;
  relatedHistoryMonths: number;
  syncCalendar?: string | string[];
}) {
  return {
    title: buildDashboardPageHref({
      ...activeViewConfig,
      historyMonths,
      relatedHistoryMonths,
      sort: getNextSort(activeViewConfig.sort, "title_asc", "title_desc"),
      syncCalendar,
    }),
    participantCount: buildDashboardPageHref({
      ...activeViewConfig,
      historyMonths,
      relatedHistoryMonths,
      sort: getNextSort(
        activeViewConfig.sort,
        "participants_desc",
        "participants_asc",
      ),
      syncCalendar,
    }),
    duration: buildDashboardPageHref({
      ...activeViewConfig,
      historyMonths,
      relatedHistoryMonths,
      sort: getNextSort(
        activeViewConfig.sort,
        "duration_desc",
        "duration_asc",
      ),
      syncCalendar,
    }),
    startedAt: buildDashboardPageHref({
      ...activeViewConfig,
      historyMonths,
      relatedHistoryMonths,
      sort: getNextSort(activeViewConfig.sort, "time_desc", "time_asc"),
      syncCalendar,
    }),
  };
}

function getNextHistoryMonths(currentMonths: number) {
  return Math.min(
    MAX_MEETING_LIBRARY_HISTORY_MONTHS,
    currentMonths + MEETING_LIBRARY_HISTORY_MONTH_STEP,
  );
}

function withRelatedHistoryLinks(
  meetings: Parameters<typeof MeetingList>[0]["meetings"],
  input: {
    activeViewConfig: MeetingLibraryViewConfig;
    historyMonths: number;
    relatedHistoryMonths: number;
    syncCalendar?: string | string[];
  },
) {
  return meetings.map((meeting) => {
    if (!meeting.hasMoreRelatedMeetings) {
      return meeting;
    }

    const nextRelatedHistoryMonths = getNextHistoryMonths(
      input.relatedHistoryMonths,
    );

    if (nextRelatedHistoryMonths <= input.relatedHistoryMonths) {
      return meeting;
    }

    return {
      ...meeting,
      relatedHistoryHref: buildDashboardPageHref({
        ...input.activeViewConfig,
        historyMonths: input.historyMonths,
        relatedHistoryMonths: nextRelatedHistoryMonths,
        syncCalendar: input.syncCalendar,
      }),
      relatedHistoryMonths: input.relatedHistoryMonths,
    };
  });
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
