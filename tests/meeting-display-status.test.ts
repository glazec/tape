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
});
