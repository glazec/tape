import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { allowedDomains } from "@/db/schema";

const IOSG_TEAM_DOMAIN = "iosg.vc";

export async function isTwentyCrmTeam(teamId: string) {
  const [domain] = await db
    .select({ id: allowedDomains.id })
    .from(allowedDomains)
    .where(
      and(
        eq(allowedDomains.teamId, teamId),
        eq(allowedDomains.domain, IOSG_TEAM_DOMAIN),
      ),
    )
    .limit(1);

  return Boolean(domain);
}
