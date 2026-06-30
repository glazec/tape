export type LocalRecorderMeetingStatus =
  | "scheduled"
  | "recording"
  | "processing"
  | "ready"
  | "failed"
  | "missed"
  | "cancelled";

export type LocalRecorderCandidate = {
  activeTranscriptJob: boolean;
  endedAt: Date | null;
  latestRecallCode: string | null;
  latestRecallStatus: string | null;
  meetingId: string;
  meetingUrl: string | null;
  recallAudioAsset: boolean;
  recallRecordingId: string | null;
  startedAt: Date | null;
  status: LocalRecorderMeetingStatus;
};

type EligibilityInput = {
  now: Date;
};

export type LocalRecorderEligibility =
  | {
      eligible: true;
      expiresAt: Date;
      reason: "eligible";
    }
  | {
      eligible: false;
      reason:
        | "before_grace_window"
        | "missing_meeting_link"
        | "missing_start_time"
        | "outside_recording_window"
        | "recall_has_join_or_recording_evidence"
        | "status_not_eligible";
    };

const FALLBACK_GRACE_MS = 70 * 1000;
const DEFAULT_RECORDING_WINDOW_MS = 2 * 60 * 60 * 1000;
const ENDED_AT_EXTENSION_MS = 15 * 60 * 1000;
const recallPositivePattern =
  /\b(in_call|joined|recording|recording_done|complete)\b/;

export function getLocalRecorderEligibility(
  meeting: LocalRecorderCandidate,
  input: EligibilityInput,
): LocalRecorderEligibility {
  if (!meeting.meetingUrl) {
    return { eligible: false, reason: "missing_meeting_link" };
  }

  if (!meeting.startedAt) {
    return { eligible: false, reason: "missing_start_time" };
  }

  const eligibleAt = new Date(meeting.startedAt.getTime() + FALLBACK_GRACE_MS);

  if (input.now < eligibleAt) {
    return { eligible: false, reason: "before_grace_window" };
  }

  const expiresAt = getLocalRecorderWindowEnd(meeting);

  if (input.now > expiresAt) {
    return { eligible: false, reason: "outside_recording_window" };
  }

  if (hasRecallJoinOrRecordingEvidence(meeting)) {
    return {
      eligible: false,
      reason: "recall_has_join_or_recording_evidence",
    };
  }

  if (!isEligibleMeetingStatus(meeting)) {
    return { eligible: false, reason: "status_not_eligible" };
  }

  return { eligible: true, expiresAt, reason: "eligible" };
}

export function isLocalRecorderUploadMatch(input: {
  intentExpiresAt: Date;
  intentMeetingId: string;
  meetingId: string;
  recordingStartedAt: Date;
}) {
  return (
    input.intentMeetingId === input.meetingId &&
    input.recordingStartedAt <= input.intentExpiresAt
  );
}

export function canUploadLocalRecorderAttempt(input: {
  attemptState: string;
  intentExpiresAt: Date;
  intentMeetingId: string;
  meetingId: string;
  recordingStartedAt: Date;
}) {
  if (input.attemptState !== "started" && input.attemptState !== "uploading") {
    return false;
  }

  return isLocalRecorderUploadMatch(input);
}

export function choosePrimaryRecordingSource(input: {
  localClaimStartedAt: Date | null;
  recallAudioAvailableAt: Date | null;
}) {
  if (!input.localClaimStartedAt) {
    return input.recallAudioAvailableAt ? "recall" : null;
  }

  if (!input.recallAudioAvailableAt) {
    return "local_recorder";
  }

  return input.recallAudioAvailableAt < input.localClaimStartedAt
    ? "recall"
    : "local_recorder";
}

function getLocalRecorderWindowEnd(meeting: LocalRecorderCandidate) {
  if (meeting.endedAt) {
    return new Date(meeting.endedAt.getTime() + ENDED_AT_EXTENSION_MS);
  }

  return new Date(
    (meeting.startedAt?.getTime() ?? 0) + DEFAULT_RECORDING_WINDOW_MS,
  );
}

function hasRecallJoinOrRecordingEvidence(meeting: LocalRecorderCandidate) {
  if (meeting.recallRecordingId || meeting.recallAudioAsset) {
    return true;
  }

  const recallState = [
    meeting.latestRecallStatus,
    meeting.latestRecallCode,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return recallPositivePattern.test(recallState);
}

function isEligibleMeetingStatus(meeting: LocalRecorderCandidate) {
  if (
    meeting.status === "scheduled" ||
    meeting.status === "missed" ||
    meeting.status === "failed"
  ) {
    return true;
  }

  return meeting.status === "processing" && !meeting.activeTranscriptJob;
}
