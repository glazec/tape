export function organizationHeaders(teamId?: string): Record<string, string> {
  return teamId ? { "x-tape-organization": teamId } : {};
}
