import { describe, expect, it } from "vitest";

import { shouldAutoRefreshMeeting } from "@/components/meeting-auto-refresh";

describe("shouldAutoRefreshMeeting", () => {
  it("polls while a transcript is still processing and empty", () => {
    expect(
      shouldAutoRefreshMeeting({
        meetingStatus: "processing",
        segmentCount: 0,
        transcriptJobStatus: "running",
      }),
    ).toBe(true);
  });

  it("keeps polling after partial transcript segments are available", () => {
    expect(
      shouldAutoRefreshMeeting({
        meetingStatus: "processing",
        segmentCount: 3,
        transcriptJobStatus: "running",
      }),
    ).toBe(true);
  });

  it("polls while translation is active after transcript segments exist", () => {
    expect(
      shouldAutoRefreshMeeting({
        meetingStatus: "ready",
        segmentCount: 3,
        transcriptJobStatus: "completed",
        translationStatus: "running",
      }),
    ).toBe(true);
  });

  it("does not poll terminal statuses", () => {
    expect(
      shouldAutoRefreshMeeting({
        meetingStatus: "failed",
        segmentCount: 0,
        transcriptJobStatus: "failed",
      }),
    ).toBe(false);
  });

  it("does not poll missed bot joins", () => {
    expect(
      shouldAutoRefreshMeeting({
        meetingStatus: "missed",
        segmentCount: 0,
        transcriptJobStatus: null,
      }),
    ).toBe(false);
  });
});
