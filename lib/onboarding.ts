export function getOnboardingHiddenCookieName({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}) {
  return `tape_onboarding_hidden_${userId}_${teamId}`;
}

type CalendarReadinessStatus = {
  accounts?: CalendarReadinessStatus[];
  autoJoinEnabled: boolean;
  connected: boolean;
  recallCalendarStatus: string | null;
};

/**
 * Whether a calendar is capturing meetings automatically. With several
 * Google accounts the summary keeps each account's state in `accounts`,
 * so one ready account is enough.
 */
export function isCalendarReady(status: CalendarReadinessStatus | null): boolean {
  if (!status) return false;

  if (status.accounts?.length) {
    return status.accounts.some((account) => isCalendarReady(account));
  }

  return (
    status.connected &&
    status.autoJoinEnabled &&
    status.recallCalendarStatus === "connected"
  );
}

export function isOnboardingAutomaticallyComplete({
  calendarStatus,
  desktopAppConnected,
  mcpUsed,
}: {
  calendarStatus: CalendarReadinessStatus | null;
  desktopAppConnected: boolean;
  mcpUsed: boolean;
}) {
  return isCalendarReady(calendarStatus) && desktopAppConnected && mcpUsed;
}
