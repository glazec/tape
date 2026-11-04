import { z } from "zod";
import { initializeDatabaseClaimsContext, setDatabaseWorkspace } from "@/db/rls-context";
import { executeIntelSearch, markIntelJobInterrupted } from "@/lib/intel/jobs";
import { inngest } from "./client";

const jobSchema = z.object({ id: z.uuid(), userId: z.uuid(), teamId: z.uuid() });

export const runIntelSearch = inngest.createFunction({
  id: "run-intel-search", retries: 2, concurrency: [{ limit: 4 }, { limit: 1, key: "event.data.id" }],
  onFailure: async ({ event }) => {
    const job = jobSchema.parse(event.data.event.data);
    initializeDatabaseClaimsContext();
    setDatabaseWorkspace(job);
    await markIntelJobInterrupted({ ...job, domain: "" }, job.id);
  },
  triggers: [{ event: "intel/search.requested" }],
}, async ({ event, step }) => {
  const job = jobSchema.parse(event.data);
  await step.run("match", async () => {
    initializeDatabaseClaimsContext();
    setDatabaseWorkspace(job);
    await executeIntelSearch({ ...job, domain: "" }, job.id);
  });
});
