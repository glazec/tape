import { z } from "zod";
import { inngest } from "@/inngest/client";
import { generateMeetingIntel, INTEL_MAX_FAILURES } from "@/lib/intel/generation";
import { ProviderCreditExhaustedError } from "@/lib/provider-credit";

export const generateIntelOnTranscript = inngest.createFunction({
  id: "generate-meeting-intel", retries: 2, concurrency: [{ limit: 3 }, { limit: 1, key: "event.data.meetingId" }],
  triggers: [{ event: "meeting/enrich.transcript" }, { event: "meeting/intel.generate" }],
}, async ({ event, step }) => {
  const { meetingId } = z.object({ meetingId: z.uuid() }).parse(event.data);
  for (let attempt = 0; attempt < 10; attempt++) {
    const outcome = await step.run(`extract-${attempt}`, async () => {
      try { return await generateMeetingIntel(meetingId); }
      catch (error) { if (error instanceof ProviderCreditExhaustedError) return { status: "credit_exhausted" }; throw error; }
    });
    if (!["not_ready", "transcript_changed", "meeting_changed"].includes(outcome.status)) return outcome;
    await step.sleep(`wait-${attempt}`, "30s");
  }
  return { status: "not_ready" };
});

// Gradually indexes existing meetings and repairs extraction after speaker or text edits.
// The per-meeting worker rechecks ownership, freshness and available provider credit.
export const reconcileMeetingIntel = inngest.createFunction({
  id: "reconcile-meeting-intel", triggers: [{ cron: "17 * * * *" }], concurrency: { limit: 1 },
}, async ({ step }) => {
  const candidates = await step.run("find-stale-intel", async () => {
    const { db } = await import("@/db/client");
    const { meetings, transcriptSegments } = await import("@/db/schema");
    const { and, eq, sql } = await import("drizzle-orm");
    return db.select({ id: meetings.id }).from(meetings).where(and(eq(meetings.status, "ready"),
      sql`exists (select 1 from ${transcriptSegments} where ${transcriptSegments.meetingId} = ${meetings.id})`,
      sql`coalesce((${meetings.aiIntel}->>'checkedAt')::timestamptz, '-infinity'::timestamptz) < now() - interval '6 hours'`,
      sql`(${meetings.aiIntel} is null or greatest(${meetings.updatedAt},
        (select max(s.updated_at) from transcript_segments s where s.meeting_id = ${meetings.id}))
        > coalesce((${meetings.aiIntel}->>'generatedAt')::timestamptz, '-infinity'::timestamptz))`,
      // Skip transcripts that already failed extraction repeatedly and have not changed since.
      sql`not (coalesce((${meetings.aiIntel}->>'failures')::int, 0) >= ${INTEL_MAX_FAILURES}
        and greatest(${meetings.updatedAt}, (select max(s.updated_at) from transcript_segments s where s.meeting_id = ${meetings.id}))
        <= (${meetings.aiIntel}->>'failedAt')::timestamptz)`,
    )).orderBy(sql`coalesce((${meetings.aiIntel}->>'checkedAt')::timestamptz, '-infinity'::timestamptz)`, meetings.updatedAt).limit(50);
  });
  if (candidates.length) await step.sendEvent("queue-intel", candidates.map(m => ({ name: "meeting/intel.generate", data: { meetingId: m.id } })));
  return { queued: candidates.length };
});
