export const MEETING_BOT_RECOVERY_WINDOW_MS = 15 * 60 * 1_000;

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

  return (
    Number.isFinite(recoveryStartedAt) &&
    now >= recoveryStartedAt &&
    now - recoveryStartedAt <= MEETING_BOT_RECOVERY_WINDOW_MS
  );
}
