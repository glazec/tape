import { NonRetriableError } from "inngest";
import { z } from "zod";
import { initializeDatabaseClaimsContext, setDatabaseWorkspace } from "@/db/rls-context";
import { failIntelJob, finalizeIntelJob, IntelStepStopped, markIntelJobInterrupted, matchIntelBatch, planIntelJob, verifyIntelBatch } from "@/lib/intel/jobs";
import { inngest } from "./client";

const jobSchema = z.object({ id: z.uuid(), userId: z.uuid(), teamId: z.uuid() });

// Each step is its own HTTP request, so a long search never runs into the
// proxy's request limit, and a retry repeats only the batch that failed.
// The per-search limit keeps three matching calls in flight, as before.
export const runIntelSearch = inngest.createFunction({
  id: "run-intel-search", retries: 2, concurrency: [{ limit: 12 }, { limit: 3, key: "event.data.id" }],
  cancelOn: [{ event: "intel/search.cancelled", match: "data.id" }],
  onFailure: async ({ event }) => {
    const job = jobSchema.parse(event.data.event.data);
    initializeDatabaseClaimsContext();
    setDatabaseWorkspace(job);
    await markIntelJobInterrupted({ ...job, domain: "" }, job.id);
  },
  triggers: [{ event: "intel/search.requested" }],
}, async ({ event, step }) => {
  const job = jobSchema.parse(event.data);
  const workspace = { ...job, domain: "" };
  async function guarded<T>(perform: () => Promise<T>) {
    initializeDatabaseClaimsContext();
    setDatabaseWorkspace(job);
    try { return await perform(); }
    catch (error) {
      if (error instanceof IntelStepStopped) throw new NonRetriableError("Intel search is no longer running");
      if (await failIntelJob(workspace, job.id, error)) throw new NonRetriableError("Intel search stopped", { cause: error });
      throw error;
    }
  }
  const plan = await step.run("plan", () => guarded(() => planIntelJob(workspace, job.id)));
  if (!plan) return;
  const candidates = await Promise.all(plan.batches.map(async (ids, index) => {
    const matched = await step.run(`match-${index}`, () => guarded(() => matchIntelBatch(workspace, job.id, index, ids, plan.meetingId)));
    return step.run(`verify-${index}`, () => guarded(() => verifyIntelBatch(workspace, job.id, index, ids, plan.meetingId, matched)));
  }));
  await step.run("finalize", () => guarded(() => finalizeIntelJob(workspace, job.id, candidates, plan.snapshot, plan.meetingId)));
});
