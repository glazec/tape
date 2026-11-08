import { NonRetriableError } from "inngest";
import { z } from "zod";
import { initializeDatabaseClaimsContext, setDatabaseWorkspace } from "@/db/rls-context";
import { failIntelJob, intelJobState, IntelStepStopped, markIntelJobInterrupted, runIntelJob } from "@/lib/intel/jobs";
import { INTEL_SEARCH_CONCURRENT_SEARCHES } from "@/lib/intel/limits";
import { inngest } from "./client";

const jobSchema = z.object({ id: z.uuid(), userId: z.uuid(), teamId: z.uuid() });

// The web server starts each search as soon as it is queued. This durable run is
// the backup: it watches the job and runs the search only when no process claimed
// it or the claiming process stopped advancing (for example during a deploy).
// One run per search id; a bounded number of searches run at once.
export const runIntelSearch = inngest.createFunction({
  id: "run-intel-search", retries: 2, concurrency: [{ limit: INTEL_SEARCH_CONCURRENT_SEARCHES }, { limit: 1, key: "event.data.id" }],
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
  for (let check = 0; check < 40; check++) {
    const state = await step.run(`check-${check}`, () => guarded(() => intelJobState(workspace, job.id)));
    if (state === "done") return;
    if (state === "claimable") {
      await step.run(`search-${check}`, () => guarded(() => runIntelJob(workspace, job.id, { takeover: true })));
      return;
    }
    await step.sleep(`wait-${check}`, "20s");
  }
});
