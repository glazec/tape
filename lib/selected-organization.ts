import { cookies, headers } from "next/headers";

export const ORGANIZATION_COOKIE = "tape_organization";

export async function getSelectedOrganization() {
  // Background jobs and command line tools do not have a browser request.
  let store;
  try {
    const teamId = (await headers()).get("x-tape-organization");
    if (teamId) return { teamId, required: true };
    store = await cookies();
  } catch {
    return undefined;
  }
  const teamId = store.get(ORGANIZATION_COOKIE)?.value;
  return teamId ? { teamId, required: false } : undefined;
}
