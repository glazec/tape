import { describe, expect, it } from "vitest";

import { getMeetingDisplayStatus, needsMoreSpeakerLabels } from "@/lib/meeting-display-status";

describe("getMeetingDisplayStatus", () => {
  it("flags ready transcripts that need more speaker labels", () => {
    expect(getMeetingDisplayStatus({ meetingStatus: "ready", needsSpeakerLabel: true })).toBe("wait_speaker_label");
    expect(getMeetingDisplayStatus({ meetingStatus: "ready", needsSpeakerLabel: false })).toBe("ready");
    expect(getMeetingDisplayStatus({ meetingStatus: "processing", needsSpeakerLabel: true })).toBe("processing");
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

describe("needsMoreSpeakerLabels", () => {
  it.each([
    [0, 0, false],
    [5, 2, true],
    [5, 1, true],
    [6, 1, false],
    [1, 0, false],
  ] as const)("checks %i milliseconds with %i unlabeled", (total, unlabeled, expected) => {
    expect(needsMoreSpeakerLabels([{ total, unlabeled }])).toBe(expected);
  });

  it("combines speaking time across recordings before applying the threshold", () => {
    expect(needsMoreSpeakerLabels([{ total: 5, unlabeled: 0 }, { total: 1, unlabeled: 1 }])).toBe(false);
  });
});
