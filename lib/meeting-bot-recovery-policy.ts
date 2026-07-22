export const MEETING_BOT_RECOVERY_WINDOW_MS = 15 * 60 * 1_000;

export function isMeetingBotRecoveryEligible(input: {
  canManage: boolean;
  endedAt?: string | null;
  now?: Date;
  platform: string;
  segmentCount: number;
  startedAt: string | null;
  status: string;
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

  const recoveryStartedAt = new Date(
    input.endedAt ?? input.startedAt ?? "",
  ).getTime();
  const now = (input.now ?? new Date()).getTime();

  return (
    Number.isFinite(recoveryStartedAt) &&
    now >= recoveryStartedAt &&
    now - recoveryStartedAt <= MEETING_BOT_RECOVERY_WINDOW_MS
  );
}
