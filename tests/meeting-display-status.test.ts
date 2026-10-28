import { describe, expect, it } from "vitest";

import { getMeetingDisplayStatus } from "@/lib/meeting-display-status";

describe("getMeetingDisplayStatus", () => {
  it("surfaces queued transcription jobs instead of generic processing", () => {
    expect(
      getMeetingDisplayStatus({
        meetingStatus: "processing",
        transcriptJobStatus: "queued",
      }),
    ).toBe("queued");
  });

  it("surfaces running transcription jobs as transcribing", () => {
    expect(
      getMeetingDisplayStatus({
        meetingStatus: "processing",
        transcriptJobStatus: "running",
      }),
    ).toBe("transcribing");
  });

  it("keeps terminal meeting statuses authoritative", () => {
    expect(
      getMeetingDisplayStatus({
        meetingStatus: "ready",
        transcriptJobStatus: "running",
      }),
    ).toBe("ready");
  });

  it("shows a bot held in the waiting room instead of recording", () => {
    expect(
      getMeetingDisplayStatus({
        botState: "waiting_room",
        meetingStatus: "recording",
      }),
    ).toBe("waiting_room");
    expect(
      getMeetingDisplayStatus({
        botState: "waiting_room",
        meetingStatus: "scheduled",
      }),
    ).toBe("waiting_room");
  });

  it("ignores a stale waiting room once the meeting has moved on", () => {
    expect(
      getMeetingDisplayStatus({
        botState: "waiting_room",
        meetingStatus: "missed",
      }),
    ).toBe("missed");
  });
});
