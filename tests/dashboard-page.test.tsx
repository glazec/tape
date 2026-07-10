import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getCalendarConnectionSummaryForWorkspace,
  getDefaultMeetingLibraryView,
  getMeetingDashboardSummaryForWorkspace,
  getWorkspace,
  getWorkspaceAccessSummary,
  listMeetingLibraryPageForWorkspace,
  requireCurrentUser,
} = vi.hoisted(() => ({
  getCalendarConnectionSummaryForWorkspace: vi.fn(),
  getDefaultMeetingLibraryView: vi.fn(),
  getMeetingDashboardSummaryForWorkspace: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
  listMeetingLibraryPageForWorkspace: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/calendar-automation-panel", () => ({
  CalendarAutomationPanel: () => <div />,
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

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
  getWorkspaceAccessSummary,
}));

describe("DashboardPage", () => {
  afterEach(() => {
    getCalendarConnectionSummaryForWorkspace.mockReset();
    getDefaultMeetingLibraryView.mockReset();
    getMeetingDashboardSummaryForWorkspace.mockReset();
    getWorkspace.mockReset();
    getWorkspaceAccessSummary.mockReset();
    listMeetingLibraryPageForWorkspace.mockReset();
    requireCurrentUser.mockReset();
    vi.resetModules();
  });

  it("uses search params for meeting library pagination", async () => {
    const workspace = {
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
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
    const html = renderToStaticMarkup(
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
    expect(html).toContain('value="participants" selected="">Participants</option>');
    expect(html).toContain('name="sort"');
    expect(html).toContain('value="duration_desc" selected="">Longest first</option>');
    expect(html).not.toContain("Save as my view");
    expect(html).toContain("Showing last 12 months, page 2");
    expect(html).toContain("min-w-0 space-y-2");
    expect(html).toContain("h-8 w-full min-w-0");
    expect(html).toContain("flex min-w-0 flex-wrap items-center gap-2");
    expect(html).toContain(
      "/dashboard?q=founder&amp;scope=participants&amp;status=ready&amp;sort=duration_desc&amp;syncCalendar=1&amp;historyMonths=12&amp;relatedMonths=18",
    );
    expect(html).toContain(
      "/dashboard?q=founder&amp;scope=participants&amp;status=ready&amp;sort=duration_desc&amp;syncCalendar=1&amp;historyMonths=12&amp;relatedMonths=18&amp;page=3",
    );
    expect(html).toContain("Showing last 12 months");
    expect(html).toContain("Load more meetings");
  });

  it("uses a saved default meeting view when the dashboard opens without filters", async () => {
    const workspace = {
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
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
    const html = renderToStaticMarkup(
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
});
