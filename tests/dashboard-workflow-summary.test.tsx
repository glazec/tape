import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardWorkflowSummary } from "@/components/dashboard-workflow-summary";
import {
  getDashboardWorkflowSummary,
  type DashboardWorkflowMeeting,
} from "@/lib/dashboard-workflow-summary";

describe("DashboardWorkflowSummary", () => {
  it("separates covered upcoming joins from meetings needing attention", () => {
    const summary = getDashboardWorkflowSummary(
      [
        meeting({
          title: "Partner weekly",
          startedAt: "2026-06-27T14:00:00.000Z",
          status: "scheduled",
          hasRecallBot: true,
        }),
        meeting({
          title: "Founder intro",
          startedAt: "2026-06-27T15:00:00.000Z",
          status: "scheduled",
          hasRecallBot: false,
        }),
        meeting({
          title: "IC memo review",
          startedAt: "2026-06-26T15:00:00.000Z",
          status: "scheduled",
          hasRecallBot: true,
        }),
        meeting({
          title: "Board prep",
          status: "ready",
        }),
        meeting({
          title: "Portfolio ops",
          status: "failed",
        }),
        meeting({
          title: "CRM cleanup",
          status: "processing",
          transcriptJobStatus: "running",
        }),
      ],
      new Date("2026-06-27T12:00:00.000Z"),
    );

    expect(summary.upcomingBotJoins).toBe(1);
    expect(summary.readyTranscripts).toBe(1);
    expect(summary.activeWork).toBe(1);
    expect(summary.failedMeetings).toBe(1);
    expect(summary.scheduledWithoutBot).toBe(1);
    expect(summary.overdueScheduled).toBe(1);
    expect(summary.needsAttention).toBe(3);
    expect(summary.nextBotJoin).toEqual({
      title: "Partner weekly",
      startedAt: "2026-06-27T14:00:00.000Z",
    });
  });

  it("renders investor and ops workflow labels", () => {
    const html = renderToStaticMarkup(
      <DashboardWorkflowSummary
        summary={getDashboardWorkflowSummary([
          meeting({
            title: "Founder follow up",
            startedAt: "2999-01-01T14:00:00.000Z",
            status: "scheduled",
            hasRecallBot: true,
          }),
          meeting({ title: "Diligence notes", status: "ready" }),
        ])}
      />,
    );

    expect(html).toContain("Upcoming joins");
    expect(html).toContain("Ready for review");
    expect(html).toContain("Needs attention");
    expect(html).toContain("IC notes");
    expect(html).toContain("Founder follow up");
  });
});

function meeting(
  overrides: Partial<DashboardWorkflowMeeting>,
): DashboardWorkflowMeeting {
  return {
    title: "Meeting",
    startedAt: "2026-06-27T10:00:00.000Z",
    status: "ready",
    transcriptJobStatus: null,
    hasRecallBot: false,
    ...overrides,
  };
}
