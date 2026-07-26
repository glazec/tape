import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookies,
  getCalendarConnectionSummaryForWorkspace,
  getDefaultMeetingLibraryView,
  getMeetingDashboardSummaryForWorkspace,
  getOnboardingSetupActivityForWorkspace,
  getWorkspaceProviderCreditStatus,
  getWorkspace,
  getWorkspaceAccessSummary,
  listMeetingLibraryPageForWorkspace,
  requireCurrentUser,
} = vi.hoisted(() => ({
  cookies: vi.fn(),
  getCalendarConnectionSummaryForWorkspace: vi.fn(),
  getDefaultMeetingLibraryView: vi.fn(),
  getMeetingDashboardSummaryForWorkspace: vi.fn(),
  getOnboardingSetupActivityForWorkspace: vi.fn(),
  getWorkspaceProviderCreditStatus: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
  listMeetingLibraryPageForWorkspace: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/calendar-automation-panel", () => ({
  CalendarAutomationPanel: () => <div />,
}));

vi.mock("@/components/onboarding-tutorial", () => ({
  OnboardingTutorial: ({
    calendarStatus,
  }: {
    calendarStatus: { recallCalendarStatus: string | null };
  }) => (
    <div>
      Onboarding tutorial: {calendarStatus.recallCalendarStatus ?? "not connected"}
    </div>
  ),
}));

vi.mock("@/lib/auth-guards", () => ({
  requireCurrentUser,
}));

vi.mock("@/lib/calendar-connection-queries", () => ({
  getCalendarConnectionSummaryForWorkspace,
}));

vi.mock("@/lib/meeting-queries", () => ({
  DEFAULT_MEETING_LIBRARY_HISTORY_MONTHS: 6,
  DEFAULT_RELATED_MEETING_HISTORY_MONTHS: 2,
  MAX_MEETING_LIBRARY_HISTORY_MONTHS: 60,
  MEETING_LIBRARY_HISTORY_MONTH_STEP: 6,
  getMeetingDashboardSummaryForWorkspace,
  listMeetingLibraryPageForWorkspace,
}));

vi.mock("@/lib/meeting-library-views", () => ({
  getDefaultMeetingLibraryView,
}));

vi.mock("@/lib/provider-credit", () => ({
  getWorkspaceProviderCreditStatus,
}));

vi.mock("@/lib/onboarding-queries", () => ({
  getOnboardingSetupActivityForWorkspace,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
  getWorkspaceAccessSummary,
}));

async function renderDashboard(element: ReactNode) {
  const stream = await renderToReadableStream(element);

  await stream.allReady;

  return (await new Response(stream).text()).replace(/<!--[\s\S]*?-->/g, "");
}

describe("DashboardPage", () => {
  beforeEach(() => {
    cookies.mockResolvedValue({
      get: () => ({ value: "1" }),
    });
    getOnboardingSetupActivityForWorkspace.mockResolvedValue({
      desktopAppConnected: false,
      mcpUsed: false,
    });
  });

  afterEach(() => {
    cookies.mockReset();
    getCalendarConnectionSummaryForWorkspace.mockReset();
    getDefaultMeetingLibraryView.mockReset();
    getMeetingDashboardSummaryForWorkspace.mockReset();
    getOnboardingSetupActivityForWorkspace.mockReset();
    getWorkspaceProviderCreditStatus.mockReset();
    getWorkspace.mockReset();
    getWorkspaceAccessSummary.mockReset();
    listMeetingLibraryPageForWorkspace.mockReset();
    requireCurrentUser.mockReset();
    vi.resetModules();
  });

  it("starts the saved meeting view query while access summary is loading", async () => {
    const workspace = {
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
      creditLimitUsdMicros: null,
    };
    let resolveAccessSummary: (
      value: Awaited<ReturnType<typeof getWorkspaceAccessSummary>>,
    ) => void = () => {};

    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: "Tape User",
    });
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockReturnValue(
      new Promise((resolve) => {
        resolveAccessSummary = resolve;
      }),
    );
    getDefaultMeetingLibraryView.mockResolvedValue(null);

    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const pagePromise = DashboardPage({
      searchParams: Promise.resolve({}),
    });

    await vi.waitFor(() => {
      expect(getWorkspaceAccessSummary).toHaveBeenCalledWith(workspace);
      expect(getDefaultMeetingLibraryView).toHaveBeenCalledWith(workspace);
    });

    resolveAccessSummary({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: false,
      isSharedOnly: false,
    });
    await pagePromise;
  });

  it("streams dashboard section skeletons before their queries finish", async () => {
    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: "Tape User",
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
      creditLimitUsdMicros: null,
    });
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    getDefaultMeetingLibraryView.mockReturnValue(new Promise(() => {}));
    getMeetingDashboardSummaryForWorkspace.mockReturnValue(
      new Promise(() => {}),
    );
    getCalendarConnectionSummaryForWorkspace.mockReturnValue(
      new Promise(() => {}),
    );

    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const page = await DashboardPage({
      searchParams: Promise.resolve({}),
    });
    const stream = await renderToReadableStream(page);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let html = "";

    while (
      !html.includes('aria-label="Loading dashboard overview"') ||
      !html.includes('aria-label="Loading meetings"')
    ) {
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      html += decoder.decode(chunk.value, { stream: true });
    }

    expect(html).toContain('aria-label="Loading dashboard overview"');
    expect(html).toContain('aria-label="Loading meetings"');

    await reader.cancel();
  });

  it("uses search params for meeting library pagination", async () => {
    const workspace = {
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
      creditLimitUsdMicros: null,
    };
    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: null,
    });
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    getDefaultMeetingLibraryView.mockResolvedValue(null);
    getMeetingDashboardSummaryForWorkspace.mockResolvedValue({
      upcomingBotJoins: 0,
      readyTranscripts: 0,
      activeWork: 0,
      failedMeetings: 0,
      scheduledWithoutBot: 0,
      overdueScheduled: 0,
      needsAttention: 0,
      nextBotJoin: null,
      userStats: {
        last7DaysMeetings: 0,
        previous7DaysMeetings: 0,
        meetingChangePercent: 0,
        meetingHours: 0,
        spokenWords: 0,
        talkSharePercent: null,
        dominantEmotion: null,
      },
    });
    getCalendarConnectionSummaryForWorkspace.mockResolvedValue(null);
    listMeetingLibraryPageForWorkspace.mockResolvedValue({
      meetings: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          title: "Ready transcript",
          platform: "google_meet",
          startedAt: "2026-06-27T12:00:00.000Z",
          status: "ready",
        },
      ],
      page: 2,
      pageSize: 50,
      hasPreviousPage: true,
      hasNextPage: true,
      hasOlderMeetings: true,
      historyMonths: 12,
      relatedHistoryMonths: 18,
    });

    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const html = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({
          historyMonths: "12",
          page: "2",
          q: "founder",
          relatedMonths: "18",
          scope: "participants",
          sort: "duration_desc",
          status: "ready",
          syncCalendar: "1",
        }),
      }),
    );

    expect(listMeetingLibraryPageForWorkspace).toHaveBeenCalledWith(workspace, {
      historyMonths: 12,
      page: 2,
      query: "founder",
      relatedHistoryMonths: 18,
      searchScope: "participants",
      sort: "duration_desc",
      status: "ready",
    });
    expect(getMeetingDashboardSummaryForWorkspace).toHaveBeenCalledWith(
      workspace,
      {
        userEmail: "member@iosg.vc",
        userName: null,
      },
    );
    expect(html).toContain('name="scope"');
    expect(html).toContain('id="meeting-search-scope"');
    expect(html).toContain('value="participants"');
    expect(html).toContain("Participants");
    expect(html).toContain('name="sort"');
    expect(html).toContain('id="meeting-sort"');
    expect(html).toContain('value="duration_desc"');
    expect(html).toContain("Longest first");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Save as my view");
    expect(html).toContain("Showing last 12 months, page 2");
    expect(html).toContain("min-w-0 space-y-2");
    expect(html).toContain("h-11 w-full min-w-0");
    expect(html).toContain("flex min-w-0 flex-wrap items-center gap-2");
    expect(html).toContain(
      "/dashboard?q=founder&amp;scope=participants&amp;status=ready&amp;sort=duration_desc&amp;syncCalendar=1&amp;historyMonths=12&amp;relatedMonths=18",
    );
    expect(html).toContain(
      "/dashboard?q=founder&amp;scope=participants&amp;status=ready&amp;sort=duration_desc&amp;syncCalendar=1&amp;historyMonths=12&amp;relatedMonths=18&amp;page=3",
    );
    expect(html).toContain("Showing last 12 months");
    expect(html).toContain("Load more meetings");
    expect(html).toContain("Meetings");
    expect(html).toContain(
      '<h2 class="text-lg font-semibold tracking-[-0.01em]">Meetings</h2>',
    );
    expect(html).toContain("Welcome back, member.");
    expect(html).toContain("You had 0 meetings in the last 7 days.");
    expect(html).not.toContain("need your attention");
    expect(html).not.toContain("Everything is on track");
    expect(html).not.toContain("Workspace activity");
    expect(html).not.toContain("Meeting hub");
    expect(getWorkspaceProviderCreditStatus).not.toHaveBeenCalled();
    expect(getOnboardingSetupActivityForWorkspace).not.toHaveBeenCalled();
  });

  it("uses a saved default meeting view when the dashboard opens without filters", async () => {
    const workspace = {
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
      creditLimitUsdMicros: null,
    };
    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: null,
    });
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    getDefaultMeetingLibraryView.mockResolvedValue({
      query: "alice",
      searchScope: "participants",
      status: "all",
      sort: "participants_desc",
    });
    getMeetingDashboardSummaryForWorkspace.mockResolvedValue({
      upcomingBotJoins: 0,
      readyTranscripts: 0,
      activeWork: 0,
      failedMeetings: 0,
      scheduledWithoutBot: 0,
      overdueScheduled: 0,
      needsAttention: 0,
      nextBotJoin: null,
      userStats: {
        last7DaysMeetings: 0,
        previous7DaysMeetings: 0,
        meetingChangePercent: 0,
        meetingHours: 0,
        spokenWords: 0,
        talkSharePercent: null,
        dominantEmotion: null,
      },
    });
    getCalendarConnectionSummaryForWorkspace.mockResolvedValue(null);
    listMeetingLibraryPageForWorkspace.mockResolvedValue({
      meetings: [],
      page: 1,
      pageSize: 50,
      hasPreviousPage: false,
      hasNextPage: false,
      hasOlderMeetings: false,
      historyMonths: 6,
      relatedHistoryMonths: 2,
    });

    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const html = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(listMeetingLibraryPageForWorkspace).toHaveBeenCalledWith(workspace, {
      historyMonths: 6,
      page: 1,
      query: "alice",
      relatedHistoryMonths: 2,
      searchScope: "participants",
      sort: "participants_desc",
      status: "all",
    });
    expect(html).toContain('value="alice"');
    expect(html).toContain("My view");
  });

  it("shows onboarding until the current user hides it", async () => {
    const workspace = {
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
      creditLimitUsdMicros: null,
    };
    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: null,
    });
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: false,
      isSharedOnly: false,
    });
    cookies.mockResolvedValue({
      get: () => undefined,
    });
    getDefaultMeetingLibraryView.mockResolvedValue(null);
    getMeetingDashboardSummaryForWorkspace.mockResolvedValue({
      upcomingBotJoins: 0,
      readyTranscripts: 0,
      activeWork: 0,
      failedMeetings: 0,
      scheduledWithoutBot: 0,
      overdueScheduled: 0,
      needsAttention: 0,
      nextBotJoin: null,
      userStats: {
        last7DaysMeetings: 0,
        previous7DaysMeetings: 0,
        meetingChangePercent: 0,
        meetingHours: 0,
        spokenWords: 0,
        talkSharePercent: null,
        dominantEmotion: null,
      },
    });
    getCalendarConnectionSummaryForWorkspace.mockResolvedValue({
      connected: true,
      autoJoinEnabled: true,
      recallCalendarStatus: "connected",
      recallCalendarLastSyncedAt: null,
    });
    listMeetingLibraryPageForWorkspace.mockResolvedValue({
      meetings: [],
      page: 1,
      pageSize: 50,
      hasPreviousPage: false,
      hasNextPage: false,
      hasOlderMeetings: false,
      historyMonths: 6,
      relatedHistoryMonths: 2,
    });

    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const html = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("Onboarding tutorial: connected");
    expect(html).not.toContain("Welcome back");
    expect(html).not.toContain("Search meetings");

    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    const populatedWorkspaceHtml = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(populatedWorkspaceHtml).toContain("Onboarding tutorial: connected");
    expect(populatedWorkspaceHtml).toContain("Search meetings");

    getOnboardingSetupActivityForWorkspace.mockResolvedValue({
      desktopAppConnected: true,
      mcpUsed: true,
    });
    const automaticallyCompletedHtml = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(automaticallyCompletedHtml).not.toContain("Onboarding tutorial");
    expect(automaticallyCompletedHtml).toContain("Welcome back");

    cookies.mockResolvedValue({
      get: () => ({ value: "1" }),
    });
    const hiddenHtml = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(hiddenHtml).not.toContain("Onboarding tutorial");
    expect(hiddenHtml).toContain("Welcome back");

    const reopenedHtml = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({ setup: "1" }),
      }),
    );

    expect(reopenedHtml).toContain("Onboarding tutorial: connected");

    const calendarErrorHtml = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({
          calendarError: "sync_failed",
          setup: "1",
        }),
      }),
    );

    expect(calendarErrorHtml).toContain("Calendar setup needs attention");
    expect(calendarErrorHtml).toContain(
      "Tape could not capture your events",
    );
    expect(calendarErrorHtml).not.toContain("Try connecting again");
  });

  it("shows an alert with billing details when workspace credit is exhausted", async () => {
    const workspace = {
      userId: "user_123",
      teamId: "team_123",
      domain: "example.com",
      canCreateMeetings: true,
      creditLimitUsdMicros: 5_000_000,
    };
    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: false,
      isSharedOnly: false,
    });
    getDefaultMeetingLibraryView.mockResolvedValue(null);
    getMeetingDashboardSummaryForWorkspace.mockResolvedValue({
      upcomingBotJoins: 0,
      readyTranscripts: 0,
      activeWork: 0,
      failedMeetings: 0,
      scheduledWithoutBot: 0,
      overdueScheduled: 0,
      needsAttention: 0,
      nextBotJoin: null,
      userStats: {
        last7DaysMeetings: 0,
        previous7DaysMeetings: 0,
        meetingChangePercent: 0,
        meetingHours: 0,
        spokenWords: 0,
        talkSharePercent: null,
        dominantEmotion: null,
      },
    });
    getCalendarConnectionSummaryForWorkspace.mockResolvedValue(null);
    listMeetingLibraryPageForWorkspace.mockResolvedValue({
      meetings: [],
      page: 1,
      pageSize: 50,
      hasPreviousPage: false,
      hasNextPage: false,
      hasOlderMeetings: false,
      historyMonths: 6,
      relatedHistoryMonths: 2,
    });
    getWorkspaceProviderCreditStatus.mockResolvedValue({
      isExhausted: false,
      limitUsdMicros: 5_000_000,
      remainingUsdMicros: 1_000_000,
      usedUsdMicros: 4_000_000,
    });

    const { default: DashboardPage } = await import("@/app/dashboard/page");
    const availableHtml = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(availableHtml).not.toContain("Tape credit has been used");
    expect(getWorkspaceProviderCreditStatus).toHaveBeenCalledWith("team_123");

    getWorkspaceProviderCreditStatus.mockResolvedValue({
      isExhausted: true,
      limitUsdMicros: 5_000_000,
      remainingUsdMicros: 0,
      usedUsdMicros: 5_000_000,
    });
    const exhaustedHtml = await renderDashboard(
      await DashboardPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(exhaustedHtml).toContain("Tape credit has been used");
    expect(exhaustedHtml).toContain(
      "New recording, transcription, translation, and assistant actions are paused.",
    );
    expect(exhaustedHtml).toContain('href="/usage"');
  });
});
