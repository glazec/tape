export const MEETING_BOT_RECOVERY_WINDOW_MS = 15 * 60 * 1_000;
export const FAILED_MEETING_BOT_RECOVERY_WINDOW_MS = 60 * 60 * 1_000;
export const MEETING_RECORDING_RESUME_MIN_REMAINING_MS = 60 * 1_000;

export function isMeetingBotRecoveryEligible(input: {
  canManage: boolean;
  endedAt?: string | null;
  now?: Date;
  platform: string;
  segmentCount: number;
  startedAt: string | null;
  status: string;
  updatedAt?: string | null;
}) {
  if (
    !input.canManage ||
    input.segmentCount > 0 ||
    !["google_meet", "zoom"].includes(input.platform) ||
    !["failed", "missed"].includes(input.status) ||
    !(input.endedAt ?? input.startedAt)
  ) {
    return false;
  }

  const scheduledEnd = new Date(
    input.endedAt ?? input.startedAt ?? "",
  ).getTime();
  const statusUpdatedAt = input.updatedAt
    ? new Date(input.updatedAt).getTime()
    : Number.NaN;
  const recoveryStartedAt = Math.max(
    scheduledEnd,
    Number.isFinite(statusUpdatedAt) ? statusUpdatedAt : scheduledEnd,
  );
  const now = (input.now ?? new Date()).getTime();
  const scheduledStart = Date.parse(input.startedAt ?? "");

  if (
    Number.isFinite(scheduledStart) &&
    Number.isFinite(scheduledEnd) &&
    scheduledStart <= now &&
    scheduledEnd - now >= MEETING_RECORDING_RESUME_MIN_REMAINING_MS
  ) {
    return true;
  }

  return (
    Number.isFinite(recoveryStartedAt) &&
    now >= recoveryStartedAt &&
    now - recoveryStartedAt <=
      (input.status === "failed"
        ? FAILED_MEETING_BOT_RECOVERY_WINDOW_MS
        : MEETING_BOT_RECOVERY_WINDOW_MS)
  );
}

export function isRecentFailedMeetingBotRecoveryEligible(input: {
  canManage: boolean;
  now?: Date;
  platform: string;
  segmentCount: number;
  status: string;
  updatedAt: string | null;
}) {
  if (
    !input.canManage ||
    input.segmentCount > 0 ||
    !["google_meet", "zoom"].includes(input.platform) ||
    input.status !== "failed"
  ) {
    return false;
  }

  const failedAt = Date.parse(input.updatedAt ?? "");
  const now = (input.now ?? new Date()).getTime();

  return (
    Number.isFinite(failedAt) &&
    failedAt <= now &&
    now - failedAt <= FAILED_MEETING_BOT_RECOVERY_WINDOW_MS
  );
}

export function isMeetingRecordingResumeEligible(input: {
  canManage: boolean;
  lastRecordingEndedAt: string | null;
  now?: Date;
  platform: string;
  scheduledEndedAt: string | null;
  scheduledStartedAt: string | null;
  status: string;
}) {
  if (
    !input.canManage ||
    !["google_meet", "zoom"].includes(input.platform) ||
    !["processing", "ready"].includes(input.status)
  ) {
    return false;
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const scheduledStartMs = Date.parse(input.scheduledStartedAt ?? "");
  const scheduledEndMs = Date.parse(input.scheduledEndedAt ?? "");
  const lastRecordingEndMs = Date.parse(input.lastRecordingEndedAt ?? "");

  return (
    Number.isFinite(scheduledStartMs) &&
    Number.isFinite(scheduledEndMs) &&
    Number.isFinite(lastRecordingEndMs) &&
    scheduledStartMs <= nowMs &&
    lastRecordingEndMs <= nowMs &&
    scheduledEndMs - nowMs >= MEETING_RECORDING_RESUME_MIN_REMAINING_MS
  );
}
