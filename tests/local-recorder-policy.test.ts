import { describe, expect, it } from "vitest";

import {
  canUploadLocalRecorderAttempt,
  choosePrimaryRecordingSource,
  getLocalRecorderEligibility,
  isLocalRecorderUploadMatch,
  type LocalRecorderCandidate,
} from "@/lib/local-recorder-policy";

const baseMeeting: LocalRecorderCandidate = {
  activeTranscriptJob: false,
  endedAt: null,
  latestRecallCode: null,
  latestRecallStatus: null,
  meetingId: "meeting_123",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  recallAudioAsset: false,
  recallRecordingId: null,
  startedAt: new Date("2026-06-30T12:00:00.000Z"),
  status: "scheduled",
};

describe("local recorder policy", () => {
  it("marks a linked meeting eligible after the one minute grace window with no Recall evidence", () => {
    const result = getLocalRecorderEligibility(baseMeeting, {
      now: new Date("2026-06-30T12:01:10.000Z"),
    });

    expect(result).toEqual({
      eligible: true,
      expiresAt: new Date("2026-06-30T14:00:00.000Z"),
      reason: "eligible",
    });
  });

  it("does not mark a meeting eligible before the grace window", () => {
    expect(
      getLocalRecorderEligibility(baseMeeting, {
        now: new Date("2026-06-30T12:00:59.000Z"),
      }),
    ).toEqual({
      eligible: false,
      reason: "before_grace_window",
    });
  });

  it("does not mark a meeting eligible when Recall has joined or recorded", () => {
    expect(
      getLocalRecorderEligibility(
        {
          ...baseMeeting,
          latestRecallStatus: "in_call",
        },
        { now: new Date("2026-06-30T12:01:10.000Z") },
      ),
    ).toEqual({
      eligible: false,
      reason: "recall_has_join_or_recording_evidence",
    });

    expect(
      getLocalRecorderEligibility(
        {
          ...baseMeeting,
          recallAudioAsset: true,
          recallRecordingId: "recording_123",
        },
        { now: new Date("2026-06-30T12:01:10.000Z") },
      ),
    ).toEqual({
      eligible: false,
      reason: "recall_has_join_or_recording_evidence",
    });
  });

  it("allows processing meetings only when no transcript job exists", () => {
    expect(
      getLocalRecorderEligibility(
        {
          ...baseMeeting,
          activeTranscriptJob: true,
          status: "processing",
        },
        { now: new Date("2026-06-30T12:01:10.000Z") },
      ),
    ).toEqual({
      eligible: false,
      reason: "status_not_eligible",
    });

    expect(
      getLocalRecorderEligibility(
        {
          ...baseMeeting,
          activeTranscriptJob: false,
          status: "processing",
        },
        { now: new Date("2026-06-30T12:01:10.000Z") },
      ).eligible,
    ).toBe(true);
  });

  it("matches uploads only inside the intent window", () => {
    expect(
      isLocalRecorderUploadMatch({
        intentExpiresAt: new Date("2026-06-30T14:00:00.000Z"),
        intentMeetingId: "meeting_123",
        recordingStartedAt: new Date("2026-06-30T12:10:00.000Z"),
        meetingId: "meeting_123",
      }),
    ).toBe(true);

    expect(
      isLocalRecorderUploadMatch({
        intentExpiresAt: new Date("2026-06-30T14:00:00.000Z"),
        intentMeetingId: "meeting_123",
        recordingStartedAt: new Date("2026-06-30T15:00:00.000Z"),
        meetingId: "meeting_123",
      }),
    ).toBe(false);
  });

  it("accepts new uploads only after the fallback intent is claimed", () => {
    const uploadWindow = {
      intentExpiresAt: new Date("2026-06-30T14:00:00.000Z"),
      intentMeetingId: "meeting_123",
      meetingId: "meeting_123",
      recordingStartedAt: new Date("2026-06-30T12:10:00.000Z"),
    };

    expect(
      canUploadLocalRecorderAttempt({
        ...uploadWindow,
        attemptState: "started",
      }),
    ).toBe(true);
    expect(
      canUploadLocalRecorderAttempt({
        ...uploadWindow,
        attemptState: "uploading",
      }),
    ).toBe(true);
    expect(
      canUploadLocalRecorderAttempt({
        ...uploadWindow,
        attemptState: "notified",
      }),
    ).toBe(false);
    expect(
      canUploadLocalRecorderAttempt({
        ...uploadWindow,
        attemptState: "uploaded",
      }),
    ).toBe(false);
  });

  it("keeps local recording primary after fallback claim starts", () => {
    expect(
      choosePrimaryRecordingSource({
        localClaimStartedAt: new Date("2026-06-30T12:02:00.000Z"),
        recallAudioAvailableAt: new Date("2026-06-30T12:03:00.000Z"),
      }),
    ).toBe("local_recorder");

    expect(
      choosePrimaryRecordingSource({
        localClaimStartedAt: new Date("2026-06-30T12:02:00.000Z"),
        recallAudioAvailableAt: new Date("2026-06-30T12:01:00.000Z"),
      }),
    ).toBe("recall");
  });
});
