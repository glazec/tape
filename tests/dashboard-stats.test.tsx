// @vitest-environment happy-dom

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DashboardStats } from "@/components/dashboard-stats";
import type { CachedDashboardSummary } from "@/lib/dashboard-summary-cache-shared";

function dashboardResult(
  cachedAt: string,
  thisWeekMeetings: number,
): CachedDashboardSummary {
  return {
    cachedAt,
    summary: {
      upcomingBotJoins: 0,
      readyTranscripts: 0,
      activeWork: 0,
      failedMeetings: 0,
      scheduledWithoutBot: 0,
      overdueScheduled: 0,
      needsAttention: 0,
      nextBotJoin: null,
      userStats: {
        thisWeekMeetings,
        lastWeekMeetings: 0,
        meetingChangePercent: 0,
        meetingHours: 0,
        spokenWords: 0,
        talkSharePercent: null,
        dominantEmotion: null,
        dominantEmotionPercent: null,
      },
    },
  };
}

describe("DashboardStats", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows cached stats first and replaces them with fresh stats", async () => {
    const freshResult = dashboardResult(
      "2026-07-27T12:00:00.000Z",
      2,
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(freshResult), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);
    render(
      <DashboardStats
        initialResult={dashboardResult(
          "2000-01-01T00:00:00.000Z",
          1,
        )}
        name="Tape"
      />,
    );

    expect(
      screen.getByText("You had 1 meeting since Monday."),
    ).toBeTruthy();

    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByText("You had 2 meetings since Monday."),
      ).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/dashboard/summary/refresh",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not refresh a recent cached summary", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);
    render(
      <DashboardStats
        initialResult={dashboardResult(
          new Date().toISOString(),
          1,
        )}
        name="Tape"
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
