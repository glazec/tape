import { expect, it, vi } from "vitest";
vi.mock("@/lib/intel/jobs", () => ({ failIntelJob: vi.fn(), IntelStepStopped: class extends Error {}, markIntelJobInterrupted: vi.fn(), runIntelJob: vi.fn() }));
vi.mock("@/db/rls-context", () => ({ initializeDatabaseClaimsContext: vi.fn(), setDatabaseWorkspace: vi.fn() }));
import { runIntelSearch } from "@/inngest/intel-search";
import { INTEL_SEARCH_CONCURRENT_SEARCHES, INTEL_SEARCH_PARALLEL_BATCHES } from "@/lib/intel/limits";

it("runs each search once at a time with a bounded number of searches overall", () => {
  expect(INTEL_SEARCH_PARALLEL_BATCHES).toBe(16);
  expect(runIntelSearch.opts.concurrency).toEqual([
    { limit: INTEL_SEARCH_CONCURRENT_SEARCHES },
    { limit: 1, key: "event.data.id" },
  ]);
});
