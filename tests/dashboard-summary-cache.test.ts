import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getMeetingDashboardSummaryForWorkspace, unstableCache } = vi.hoisted(
  () => ({
    getMeetingDashboardSummaryForWorkspace: vi.fn(),
    unstableCache: vi.fn(
      (
        callback: () => Promise<unknown>,
        keyParts: string[],
        options: { revalidate: number; tags: string[] },
      ) => {
        void keyParts;
        void options;
        return callback;
      },
    ),
  }),
);

vi.mock("next/cache", () => ({
  unstable_cache: unstableCache,
}));

vi.mock("@/lib/meeting-queries", () => ({
  getMeetingDashboardSummaryForWorkspace,
}));

describe("dashboard summary cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
    getMeetingDashboardSummaryForWorkspace.mockResolvedValue({
      userStats: {
        thisWeekMeetings: 3,
      },
    });
  });

  afterEach(() => {
    getMeetingDashboardSummaryForWorkspace.mockReset();
    unstableCache.mockClear();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("scopes cached summaries to the workspace user", async () => {
    const {
      getCachedDashboardSummaryForWorkspace,
      getDashboardSummaryCacheTag,
    } = await import("@/lib/dashboard-summary-cache");
    const workspace = {
      teamId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      domain: "example.com",
    };

    await expect(
      getCachedDashboardSummaryForWorkspace(workspace, {
        userEmail: "member@example.com",
        userName: "Tape User",
      }),
    ).resolves.toMatchObject({
      cachedAt: "2026-07-27T12:00:00.000Z",
      summary: {
        userStats: {
          thisWeekMeetings: 3,
        },
      },
    });

    expect(getMeetingDashboardSummaryForWorkspace).toHaveBeenCalledWith(
      workspace,
      {
        userEmail: "member@example.com",
        userName: "Tape User",
      },
    );
    expect(unstableCache).toHaveBeenCalledWith(
      expect.any(Function),
      [
        "dashboard-summary",
        "v1",
        workspace.teamId,
        workspace.userId,
        "member@example.com",
        "Tape User",
      ],
      {
        revalidate: 3600,
        tags: [getDashboardSummaryCacheTag(workspace)],
      },
    );
  });

  it("refreshes summaries after fifteen seconds", async () => {
    const { isDashboardSummaryStale } = await import(
      "@/lib/dashboard-summary-cache-shared"
    );

    expect(
      isDashboardSummaryStale("2026-07-27T11:59:45.001Z"),
    ).toBe(false);
    expect(
      isDashboardSummaryStale("2026-07-27T11:59:45.000Z"),
    ).toBe(true);
    expect(isDashboardSummaryStale("invalid")).toBe(true);
  });
});
