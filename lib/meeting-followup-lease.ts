import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db/client";
import { meetings } from "@/db/schema";

// Call only after checking meeting access. A database lease coordinates browser
// requests and workers across processes, without holding a transaction over AI I/O.
export async function acquireFollowupLease(meetingId: string) {
  const token = randomUUID();
  const [claimed] = await db.update(meetings).set({
    followupLeaseToken: token,
    followupLeaseExpiresAt: new Date(Date.now() + 10 * 60_000),
  }).where(and(eq(meetings.id, meetingId), or(
    isNull(meetings.followupLeaseExpiresAt),
    lt(meetings.followupLeaseExpiresAt, new Date()),
  ))).returning({ id: meetings.id });
  return claimed ? token : null;
}

export async function releaseFollowupLease(meetingId: string, token: string) {
  await db.update(meetings).set({ followupLeaseToken: null, followupLeaseExpiresAt: null })
    .where(and(eq(meetings.id, meetingId), eq(meetings.followupLeaseToken, token)));
}
