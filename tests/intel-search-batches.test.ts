import { expect, it } from "vitest";
import { buildSearchBatches } from "@/lib/intel/search-batches";
import { buildCatalog, browserCatalog } from "@/lib/intel/provenance";
import type { IntelMeeting } from "@/lib/intel/types";
function meeting(id: string, speaker = id): IntelMeeting {
  return { id, title: id, date: new Date().toISOString(), startedAt: null, status: "ready", transcriptJobStatus: null,
    aiIntel: null, aiFollowup: null, segments: [{ id: `${id}-s`, startMs: 0, speaker, text: "Evidence ".repeat(50) }] };
}
const input = { kind: "content" as const, text: "Infrastructure partners" };
const source = { text: input.text };
it("searches every meeting across bounded batches without duplicating targets", () => {
  const corpus = Array.from({ length: 20 }, (_, i) => meeting(`m${i}`));
  const batches = buildSearchBatches(corpus, buildCatalog(corpus), input, source, 4000);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every(b => JSON.stringify(b).length <= 4000)).toBe(true);
  expect(batches.flatMap(b => b.meetings.map(m => m.id)).sort()).toEqual(corpus.map(m => m.id).sort());
});
it("keeps all confirmed identity history together including later reversals", () => {
  const corpus = [meeting("early", "alex@example.test"), meeting("unrelated"), meeting("later", "alex@example.test")];
  corpus[2].segments[0].text = "We no longer want infrastructure partners.";
  const batches = buildSearchBatches(corpus, buildCatalog(corpus), input, source, 2300);
  const batch = batches.find(b => b.meetings.some(m => m.id === "early"))!;
  expect(batch.meetings.map(m => m.id)).toContain("later");
});
it("includes the selected person's complete evidence in every candidate batch", () => {
  const corpus = Array.from({ length: 10 }, (_, i) => meeting(`m${i}`));
  const catalog = buildCatalog(corpus);
  const batches = buildSearchBatches(corpus, catalog, {kind: "person", ids: [catalog.people[0].id]}, source, 3000);
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every(b => b.meetings.some(m => m.id === "m0"))).toBe(true);
});
it("refuses to split one identity into misleading partial evidence", () => {
  const corpus = [meeting("early", "alex@example.test"), meeting("later", "alex@example.test")];
  expect(() => buildSearchBatches(corpus, buildCatalog(corpus), input, source, 1000)).toThrow("history is too large");
});
it("keeps evidence membership on the server while preserving browsing metadata", () => {
  const catalog = buildCatalog([meeting("m")]);
  expect(catalog.people[0].segmentIds).toEqual(["m-s"]);
  expect(browserCatalog(catalog).people[0]).not.toHaveProperty("segmentIds");
  expect(browserCatalog(catalog).people[0].sourceSegmentId).toBe("m-s");
});
