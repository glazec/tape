import { describe, expect, it } from "vitest";

import { getMeetingDisplayStatus } from "@/lib/meeting-display-status";

describe("getMeetingDisplayStatus", () => {
  it("shows a joining bot without claiming it is recording", () => {
    expect(getMeetingDisplayStatus({ botState: "joining", meetingStatus: "scheduled" })).toBe("joining");
    expect(getMeetingDisplayStatus({ botState: "joining", meetingStatus: "ready" })).toBe("ready");
  });
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


describe("combined meeting state", () => {
  it("keeps a combined meeting processing while a part has active transcript work", async () => {
    const { getComposedMeetingState } = await import("@/lib/meeting-display-status");
    expect(getComposedMeetingState({ status: "ready" }, [
      { status: "ready", transcriptJobStatus: "running" },
    ])).toMatchObject({ status: "processing" });
  });

  it("prioritizes actual capture over a waiting part and ignores stale bot states", async () => {
    const { getComposedMeetingState } = await import("@/lib/meeting-display-status");
    expect(getComposedMeetingState({ status: "recording", botState: null }, [
      { status: "scheduled", botState: "waiting_room", kind: "continuation" },
    ])).toMatchObject({ status: "recording", botState: null });
    expect(getComposedMeetingState({ status: "ready", botState: null }, [
      { status: "failed", botState: "waiting_room", kind: "continuation" },
    ])).toMatchObject({ status: "failed" });
  });
});
