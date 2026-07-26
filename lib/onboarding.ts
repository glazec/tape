export function getOnboardingHiddenCookieName({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}) {
  return `tape_onboarding_hidden_${userId}_${teamId}`;
}

export function isOnboardingAutomaticallyComplete({
  calendarStatus,
  desktopAppConnected,
  mcpUsed,
}: {
  calendarStatus: {
    autoJoinEnabled: boolean;
    connected: boolean;
    recallCalendarStatus: string | null;
  } | null;
  desktopAppConnected: boolean;
  mcpUsed: boolean;
}) {
  return Boolean(
    calendarStatus?.connected &&
      calendarStatus.autoJoinEnabled &&
      calendarStatus.recallCalendarStatus === "connected" &&
      desktopAppConnected &&
      mcpUsed,
  );
}
