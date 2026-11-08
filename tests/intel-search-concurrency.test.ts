import { expect, it, vi } from "vitest";
vi.mock("@/lib/intel/jobs", () => ({ failIntelJob: vi.fn(), finalizeIntelJob: vi.fn(), IntelStepStopped: class extends Error {}, markIntelJobInterrupted: vi.fn(), matchIntelBatch: vi.fn(), planIntelJob: vi.fn() }));
vi.mock("@/db/rls-context", () => ({ initializeDatabaseClaimsContext: vi.fn(), setDatabaseWorkspace: vi.fn() }));
import { runIntelSearch } from "@/inngest/intel-search";
import { INTEL_SEARCH_PARALLEL_BATCHES, INTEL_SEARCH_TOTAL_PARALLEL_BATCHES } from "@/lib/intel/limits";

it("scores up to eight batches of one search at once while sharing a global ceiling", () => {
  expect(INTEL_SEARCH_PARALLEL_BATCHES).toBe(8);
  expect(INTEL_SEARCH_TOTAL_PARALLEL_BATCHES).toBeGreaterThan(INTEL_SEARCH_PARALLEL_BATCHES);
  expect(runIntelSearch.opts.concurrency).toEqual([
    { limit: INTEL_SEARCH_TOTAL_PARALLEL_BATCHES },
    { limit: INTEL_SEARCH_PARALLEL_BATCHES, key: "event.data.id" },
  ]);
});
