import Link from "next/link";
import { cookies } from "next/headers";
import { Suspense } from "react";
import {
  AlertCircle,
  CalendarCheck2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Star,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { CalendarAutomationPanel } from "@/components/calendar-automation-panel";
import {
  DashboardOverviewSkeleton,
  MeetingLibrarySkeleton,
} from "@/components/dashboard-loading";
import { DashboardWorkflowSummary } from "@/components/dashboard-workflow-summary";
import { MeetingList } from "@/components/meeting-list";
import { OnboardingTutorial } from "@/components/onboarding-tutorial";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  getOnboardingHiddenCookieName,
  isOnboardingAutomaticallyComplete,
} from "@/lib/onboarding";
import { getOnboardingSetupActivityForWorkspace } from "@/lib/onboarding-queries";
import { getWorkspaceProviderCreditStatus } from "@/lib/provider-credit";
import { cn } from "@/lib/utils";
import {
  getOrCreateWorkspaceForSessionUser,
  getWorkspaceAccessSummary,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";

type DashboardSearchParams = {
  calendarError?: string | string[];
  page?: string | string[];
  historyMonths?: string | string[];
  q?: string | string[];
  relatedMonths?: string | string[];
  scope?: string | string[];
  sort?: string | string[];
  status?: string | string[];
  setup?: string | string[];
  syncCalendar?: string | string[];
  view?: string | string[];
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const cookieStorePromise = cookies();
  const [user, resolvedSearchParams] = await Promise.all([
    requireCurrentUser(),
    searchParams,
  ]);
  const {
    calendarError,
    page,
    historyMonths: historyMonthsParam,
    q,
    relatedMonths,
    scope,
    sort,
    status,
    setup,
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
  const savedViewPromise = getDefaultMeetingLibraryView(workspace);

  void savedViewPromise.catch(() => undefined);

  const accessSummary = await getWorkspaceAccessSummary(workspace);
  const showMeetingLibrary =
    accessSummary.isSharedOnly ||
    accessSummary.hasWorkspaceMeetings ||
    accessSummary.hasExternalShares ||
    hasMeetingLibraryRequest({
      historyMonths: historyMonthsParam,
      page,
      q,
      relatedMonths,
      scope,
      sort,
      status,
      view,
    });

  return (
    <AppShell
      activeHref="/dashboard"
      canCreateMeetings={accessSummary.canCreateMeetings}
      oneSignalExternalId={workspace.userId}
    >
      <section className="flex flex-col gap-6">
        {!accessSummary.isSharedOnly ? (
          <Suspense fallback={<DashboardOverviewSkeleton />}>
            <DashboardOverview
              accessSummary={accessSummary}
              calendarError={calendarError}
              cookieStorePromise={cookieStorePromise}
              setup={setup}
              syncCalendar={syncCalendar}
              user={user}
              workspace={workspace}
            />
          </Suspense>
        ) : null}

        {showMeetingLibrary ? (
          <Suspense fallback={<MeetingLibrarySkeleton />}>
            <DashboardMeetingLibrary
              currentPage={currentPage}
              historyMonths={historyMonths}
              isSharedOnly={accessSummary.isSharedOnly}
              relatedHistoryMonths={relatedHistoryMonths}
              requestedViewConfig={requestedViewConfig}
              savedViewPromise={savedViewPromise}
              searchParams={resolvedSearchParams}
              syncCalendar={syncCalendar}
              workspace={workspace}
            />
          </Suspense>
        ) : null}
      </section>
    </AppShell>
  );
}

async function DashboardOverview({
  accessSummary,
  calendarError,
  cookieStorePromise,
  setup,
  syncCalendar,
  user,
  workspace,
}: {
  accessSummary: Awaited<ReturnType<typeof getWorkspaceAccessSummary>>;
  calendarError?: string | string[];
  cookieStorePromise: ReturnType<typeof cookies>;
  setup?: string | string[];
  syncCalendar?: string | string[];
  user: Awaited<ReturnType<typeof requireCurrentUser>>;
  workspace: Awaited<ReturnType<typeof getOrCreateWorkspaceForSessionUser>>;
}) {
  const onboardingHiddenCookieName = getOnboardingHiddenCookieName(workspace);
  const onboardingForced = getSearchParamValue(setup) === "1";
  const cookieStore = await cookieStorePromise;
  const onboardingHiddenInBrowser =
    cookieStore.get(onboardingHiddenCookieName)?.value === "1";
  const [
    dashboardSummary,
    calendarStatus,
    creditStatus,
    onboardingSetupActivity,
  ] = await Promise.all([
    accessSummary.canCreateMeetings
      ? getMeetingDashboardSummaryForWorkspace(workspace, {
          userEmail: user.email,
          userName: user.name,
        })
      : Promise.resolve(null),
    accessSummary.canCreateMeetings
      ? getCalendarConnectionSummaryForWorkspace(workspace)
      : Promise.resolve(null),
    accessSummary.canCreateMeetings && workspace.creditLimitUsdMicros !== null
      ? getWorkspaceProviderCreditStatus(workspace.teamId)
      : Promise.resolve(null),
    accessSummary.canCreateMeetings &&
    !onboardingForced &&
    !onboardingHiddenInBrowser
      ? getOnboardingSetupActivityForWorkspace(workspace)
      : Promise.resolve(null),
  ]);
  const calendarErrorCode = getSearchParamValue(calendarError);
  const calendarErrorMessage = getCalendarErrorMessage(calendarErrorCode);
  const showCalendarError =
    accessSummary.canCreateMeetings &&
    calendarErrorMessage &&
    (calendarErrorCode === "sync_failed" ||
      !isCalendarOperational(calendarStatus));
  const onboardingAutomaticallyComplete =
    onboardingSetupActivity &&
    isOnboardingAutomaticallyComplete({
      calendarStatus,
      ...onboardingSetupActivity,
    });
  const showOnboarding =
    accessSummary.canCreateMeetings &&
    (onboardingForced ||
      (!onboardingAutomaticallyComplete && !onboardingHiddenInBrowser));

  return (
    <>
      {creditStatus?.isExhausted ? (
        <Alert
          className="px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-3"
          variant="destructive"
        >
          <AlertCircle />
          <AlertTitle>Tape credit has been used</AlertTitle>
          <AlertDescription>
            New recording, transcription, translation, and assistant actions are
            paused. Existing meetings remain available.
          </AlertDescription>
          <Link
            className="col-start-2 mt-2 font-medium underline underline-offset-3 hover:text-foreground sm:col-start-3 sm:row-start-1 sm:row-span-2 sm:mt-0 sm:self-center"
            href="/usage"
          >
            View billing details
          </Link>
        </Alert>
      ) : null}
      {showCalendarError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Calendar setup needs attention</AlertTitle>
          <AlertDescription>{calendarErrorMessage}</AlertDescription>
        </Alert>
      ) : null}
      {showOnboarding && calendarStatus ? (
        <OnboardingTutorial
          autoSyncCalendar={getSearchParamValue(syncCalendar) === "1"}
          calendarStatus={calendarStatus}
          dismissalCookieName={onboardingHiddenCookieName}
          forceCalendarSync={calendarErrorCode === "sync_failed"}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <DashboardGreetingCard
            meetingCount={dashboardSummary?.userStats.last7DaysMeetings ?? 0}
            name={getDashboardFirstName(user.name, user.email)}
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
    </>
  );
}

async function DashboardMeetingLibrary({
  currentPage,
  historyMonths,
  isSharedOnly,
  relatedHistoryMonths,
  requestedViewConfig,
  savedViewPromise,
  searchParams,
  syncCalendar,
  workspace,
}: {
  currentPage: number;
  historyMonths: number;
  isSharedOnly: boolean;
  relatedHistoryMonths: number;
  requestedViewConfig: MeetingLibraryViewConfig;
  savedViewPromise: ReturnType<typeof getDefaultMeetingLibraryView>;
  searchParams: DashboardSearchParams;
  syncCalendar?: string | string[];
  workspace: Awaited<ReturnType<typeof getOrCreateWorkspaceForSessionUser>>;
}) {
  const savedViewConfig = await savedViewPromise;
  const activeViewConfig =
    shouldUseSavedMeetingLibraryView(searchParams) && savedViewConfig
      ? savedViewConfig
      : requestedViewConfig;
  const meetingLibraryPage = await listMeetingLibraryPageForWorkspace(
    workspace,
    {
      historyMonths,
      page: currentPage,
      query: activeViewConfig.query ?? undefined,
      relatedHistoryMonths,
      searchScope: activeViewConfig.searchScope,
      sort: activeViewConfig.sort,
      status: activeViewConfig.status,
    },
  );

  return (
    <Card className="gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-muted/25 px-4 py-4 sm:px-5">
        <CardTitle>
          {isSharedOnly ? (
            <h1 className="text-lg font-semibold tracking-[-0.01em]">
              Meetings
            </h1>
          ) : (
            <h2 className="text-lg font-semibold tracking-[-0.01em]">
              Meetings
            </h2>
          )}
        </CardTitle>
        <CardDescription>
          {isSharedOnly
            ? "Transcripts shared with you."
            : "Search transcripts, recordings, and upcoming meetings."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col px-0">
        <MeetingLibraryControls
          activeViewConfig={activeViewConfig}
          historyMonths={meetingLibraryPage.historyMonths}
          hasSavedView={Boolean(savedViewConfig)}
          isSharedOnly={isSharedOnly}
          relatedHistoryMonths={meetingLibraryPage.relatedHistoryMonths}
          syncCalendar={syncCalendar}
        />

        <MeetingList
          emptyMessage={
            isSharedOnly
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
  );
}

function getCalendarErrorMessage(error: string | undefined) {
  switch (error) {
    case "google_denied":
      return "Google Calendar access was not granted. Try again when you are ready.";
    case "state_mismatch":
      return "The calendar connection expired before it finished. Start the connection again.";
    case "connect_failed":
      return "Tape could not finish connecting Google Calendar. Try again.";
    case "sync_failed":
      return "Google Calendar connected, but Tape could not capture your events. The calendar control is trying again.";
    default:
      return null;
  }
}

function isCalendarOperational(
  status: Awaited<
    ReturnType<typeof getCalendarConnectionSummaryForWorkspace>
  > | null,
) {
  return Boolean(
    status?.connected &&
      status.autoJoinEnabled &&
      status.recallCalendarStatus === "connected",
  );
}

function hasMeetingLibraryRequest(
  params: Record<string, string | string[] | undefined>,
) {
  return Object.values(params).some((value) =>
    Boolean(getSearchParamValue(value)),
  );
}

function DashboardGreetingCard({
  meetingCount,
  name,
}: {
  meetingCount: number;
  name: string;
}) {
  return (
    <Card className="relative min-h-36 overflow-hidden lg:row-span-2 lg:min-h-60">
      <CardContent className="flex flex-1 flex-col justify-center py-6 sm:px-7 sm:py-7">
        <div className="relative z-10 max-w-sm">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] sm:text-[1.75rem]">
            Welcome back, {name}.
          </h1>
          <p className="mt-2.5 text-[0.9375rem] leading-[1.6] text-muted-foreground">
            {formatGreetingSummary(meetingCount)}
          </p>
        </div>
        <CalendarCheck2
          aria-hidden="true"
          className="absolute right-6 bottom-6 size-20 text-foreground/[0.06] sm:right-7 sm:bottom-7 sm:size-28"
        />
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

function formatGreetingSummary(meetingCount: number) {
  return meetingCount === 1
    ? "You had 1 meeting in the last 7 days."
    : `You had ${meetingCount.toLocaleString()} meetings in the last 7 days.`;
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
  hasSavedView,
  isSharedOnly,
  relatedHistoryMonths,
  syncCalendar,
}: {
  activeViewConfig: MeetingLibraryViewConfig;
  historyMonths: number;
  hasSavedView: boolean;
  isSharedOnly: boolean;
  relatedHistoryMonths: number;
  syncCalendar?: string | string[];
}) {
  const syncCalendarValue = getSearchParamValue(syncCalendar);

  return (
    <form className="grid gap-3 border-b bg-muted/20 px-4 py-3 sm:px-5 md:grid-cols-[minmax(12rem,1fr)_10rem_auto] md:items-end">
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
            className="h-11 bg-background pl-8"
            placeholder={
              isSharedOnly
                ? "Search shared transcript"
                : "Search company, founder, speaker, or transcript"
            }
          />
        </div>
      </div>
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
      <button className={cn(buttonVariants(), "h-11")} type="submit">
        Search
      </button>
      <details className="group md:col-span-3">
        <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          More filters
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-3 grid gap-3 border-t pt-3 md:grid-cols-2">
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
            id="meeting-sort"
            label="Sort"
            name="sort"
            options={meetingLibrarySorts.map((value) => ({
              label: meetingLibrarySortLabels[value],
              value,
            }))}
            value={activeViewConfig.sort}
          />
          <div className="md:col-span-2">
            <MeetingLibraryViewBar
              activeViewConfig={activeViewConfig}
              historyMonths={historyMonths}
              hasSavedView={hasSavedView}
              relatedHistoryMonths={relatedHistoryMonths}
              syncCalendar={syncCalendar}
            />
          </div>
        </div>
      </details>
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
      <Select
        defaultValue={value}
        items={options}
        name={name}
      >
        <SelectTrigger className="h-11 w-full min-w-0 bg-background" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        </SelectContent>
      </Select>
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
