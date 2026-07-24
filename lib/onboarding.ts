export function getOnboardingHiddenCookieName({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}) {
  return `tape_onboarding_hidden_${userId}_${teamId}`;
}
