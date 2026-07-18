import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DashboardWorkflowSummary } from "@/components/dashboard-workflow-summary";
import {
  getDashboardWorkflowSummary,
  type DashboardWorkflowMeeting,
  type DashboardWorkflowSegment,
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

  it("builds user stats from recent transcript activity", () => {
    const summary = getDashboardWorkflowSummary(
      [
        meeting({
          title: "Current founder call",
          startedAt: "2026-06-27T10:00:00.000Z",
          endedAt: "2026-06-27T11:30:00.000Z",
          segments: [
            segment({
              speaker: "Test",
              text: "one two three four",
              startMs: 0,
              endMs: 10000,
              emotionLabel: "chill",
            }),
            segment({
              speaker: "Founder",
              text: "one two three four five six",
              startMs: 10000,
              endMs: 30000,
              emotionLabel: "hard",
            }),
          ],
        }),
        meeting({
          title: "Current partner sync",
          startedAt: "2026-06-26T10:00:00.000Z",
          endedAt: "2026-06-26T10:30:00.000Z",
        }),
        meeting({
          title: "Previous review",
          startedAt: "2026-06-18T10:00:00.000Z",
          endedAt: "2026-06-18T11:00:00.000Z",
          segments: [
            segment({
              speaker: "Test",
              text: "one two",
              startMs: 0,
              endMs: 8000,
            }),
          ],
        }),
      ],
      new Date("2026-06-28T12:00:00.000Z"),
      {
        userEmail: "test@iosg.vc",
        userName: "Test",
      },
    );

    expect(summary.userStats).toEqual({
      last7DaysMeetings: 2,
      previous7DaysMeetings: 1,
      meetingChangePercent: 100,
      meetingHours: 2,
      spokenWords: 4,
      talkSharePercent: 33,
      dominantEmotion: "hard",
      dominantEmotionPercent: 67,
    });
  });

  it("ignores cancelled meetings in workflow counts and user stats", () => {
    const summary = getDashboardWorkflowSummary(
      [
        meeting({
          title: "Cancelled partner sync",
          startedAt: "2026-06-27T10:00:00.000Z",
          endedAt: "2026-06-27T11:00:00.000Z",
          status: "cancelled",
        }),
      ],
      new Date("2026-06-28T12:00:00.000Z"),
    );

    expect(summary).toMatchObject({
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
        meetingHours: 0,
      },
    });
  });

  it("renders the weekly activity card without a duplicate join card", () => {
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

    expect(html).toContain("This week");
    expect(html).toContain("Meeting activity from the last 7 days.");
    expect(html).toContain("bg-secondary");
    expect(html).not.toContain("Upcoming joins");
    expect(html).not.toContain("Founder follow up");
    expect(html).not.toContain("Ready for review");
    expect(html).not.toContain("Needs attention");
  });

  it("renders the user activity card", () => {
    const summary = getDashboardWorkflowSummary(
      [
        meeting({
          startedAt: "2026-06-27T10:00:00.000Z",
          endedAt: "2026-06-27T11:30:00.000Z",
          segments: [
            segment({
              speaker: "Test",
              text: "one two three four",
              startMs: 0,
              endMs: 10000,
              emotionLabel: "chill",
            }),
            segment({
              speaker: "Founder",
              text: "one two three four five six",
              startMs: 10000,
              endMs: 30000,
              emotionLabel: "hard",
            }),
          ],
        }),
        meeting({
          startedAt: "2026-06-26T10:00:00.000Z",
          endedAt: "2026-06-26T10:30:00.000Z",
        }),
        meeting({
          startedAt: "2026-06-18T10:00:00.000Z",
          endedAt: "2026-06-18T11:00:00.000Z",
          segments: [
            segment({
              speaker: "Test",
              text: "one two",
              startMs: 0,
              endMs: 8000,
            }),
          ],
        }),
      ],
      new Date("2026-06-28T12:00:00.000Z"),
      {
        userEmail: "test@iosg.vc",
        userName: "Test",
      },
    );
    const html = renderToStaticMarkup(
      <DashboardWorkflowSummary summary={summary} />,
    );

    expect(html).toContain("This week");
    expect(html).toContain("Meetings");
    expect(html).toContain("Meeting time");
    expect(html).toContain("+100% vs last week");
    expect(html).toContain("2h");
    expect(html).toContain("Words");
    expect(html).toContain("33% talk share");
    expect(html).toContain("Tone");
    expect(html).toContain("Hard 67%");
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

function segment(
  overrides: Partial<DashboardWorkflowSegment>,
): DashboardWorkflowSegment {
  return {
    speaker: "Test",
    startMs: 0,
    endMs: 10000,
    text: "hello world",
    emotionLabel: "neutral",
    ...overrides,
  };
}
