export function getRecallCalendarAccountEmail(calendar: unknown): string | null {
  if (!calendar || typeof calendar !== "object") return null;
  const identity = calendar as { platform_email?: unknown; oauth_email?: unknown };
  for (const value of [identity.platform_email, identity.oauth_email]) {
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}
