import { expect, it } from "vitest";
import { buildSearchBatches } from "@/lib/intel/search-batches";
import { buildCatalog, browserCatalog } from "@/lib/intel/provenance";
import type { IntelMeeting } from "@/lib/intel/types";
import { estimateTokens } from "@/lib/intel/tokens";
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
it("focuses verification on candidates while retaining their reversals and source context", async () => {
 const { buildVerificationContext } = await import("@/lib/intel/search-batches");
 const a = meeting("a", "alex@example.test");
 a.segments = [
  { id: "question", speaker: "Other", text: "Are you buying GPUs?", startMs: 0 },
  { id: "answer", speaker: "alex@example.test", text: "Yes, we need them.", startMs: 1 },
  { id: "context", speaker: "Other", text: "For your inference team?", startMs: 2 },
  { id: "noise", speaker: "Other", text: "Unrelated lunch plans", startMs: 3 },
 ];
 const later = meeting("later", "alex@example.test");
 later.segments[0].text = "We no longer buy GPUs.";
 const corpus = [a, later, meeting("unrelated")];const catalog = buildCatalog(corpus);
 const batch = buildSearchBatches(corpus, catalog, input, source)[0];
 const match = { id: catalog.people.find(p => p.name === "alex@example.test")!.id, type: "person" as const, segmentIds: ["answer"], counterEvidenceIds: [] };
 const context = buildVerificationContext(batch, [match]);
 const ids = context.meetings.flatMap(m => m.segments.map(s => s.id));
 expect(ids).toEqual(["question", "answer", "context", "later-s"]);
 expect(context.people.map(p => p.id)).toEqual([match.id]);
 expect(context.source).toEqual(source);
});
it("retains the source intel speaker's history even when recommending another person", async () => {
 const { buildVerificationContext } = await import("@/lib/intel/search-batches");
 const { intelSourceHash } = await import("@/lib/intel/provenance");
 const a = meeting("source", "Source"), b = meeting("recipient", "Recipient");
 a.aiIntel = { sourceHash: intelSourceHash(a), result: { items: [{ kind: "plan", text: "Source seeks partners", importance: "normal", speakerSegmentId: "source-s", segmentIds: ["source-s"] }] } };
 const catalog = buildCatalog([a, b]);
 const batch = buildSearchBatches([a, b], catalog, { kind: "intel", id: catalog.intel[0].id }, source)[0];
 const target = catalog.people.find(p => p.name === "Recipient")!;
 const focused = buildVerificationContext(batch, [{ id: target.id, type: "person", segmentIds: ["recipient-s"], counterEvidenceIds: [] }]);
 expect(focused.intel).toHaveLength(1);
 expect(focused.meetings.map(m => m.id)).toEqual(["source", "recipient"]);
 expect(focused.people.map(p => p.name)).toEqual(["Source", "Recipient"]);
});
it("keeps all speakers when verifying a mentioned contact", async () => {
 const { buildVerificationContext } = await import("@/lib/intel/search-batches");
 const corpus = [meeting("a"), meeting("b")];
 const batch = buildSearchBatches(corpus, buildCatalog(corpus), input, source)[0];
 batch.people.push({ id: "contact", name: "Mentioned", detail: "Contact", kind: "mentioned", meetingIds: ["a", "b"], segmentIds: ["a-s"], sourceDate: corpus[0].date, sourceMeetingId: "a", sourceSegmentId: "a-s" });
 const focused = buildVerificationContext(batch, [{ id: "contact", type: "person", segmentIds: ["a-s"], counterEvidenceIds: [] }]);
 expect(focused.meetings).toEqual(batch.meetings);
});

function longMeeting(id: string, date: string, speaker: string, own: string, filler = 40): IntelMeeting {
  return { id, title: id, date, startedAt: date, status: "ready", transcriptJobStatus: null, aiIntel: null, aiFollowup: null,
    segments: [
      ...Array.from({ length: filler }, (_, i) => ({ id: `${id}-other-${i}`, startMs: i, speaker: "Other", text: "Unrelated discussion ".repeat(20) })),
      { id: `${id}-before`, startMs: filler, speaker: "Other", text: "Do you still need capacity?" },
      { id: `${id}-own`, startMs: filler + 1, speaker, text: own },
      { id: `${id}-after`, startMs: filler + 2, speaker: "Other", text: "Understood." },
    ] };
}
const recentPeople = async () => (await import("@/lib/intel/search-batches")).buildRecentPeopleBatches;

it("focuses one oversized candidate on their own statements instead of failing the search", async () => {
  const build = await recentPeople();
  const busy = ["2026-09-01", "2026-10-01", "2026-11-01"].map((d, i) => longMeeting(`busy${i}`, `${d}T12:00:00Z`, "host@example.test", i === 2 ? "We no longer need GPUs." : "We need GPUs."));
  const corpus = [...busy, meeting("maya"), meeting("ben")];
  const report = { trimmed: [] as string[], skipped: [] as string[] };
  const batches = build(corpus, buildCatalog(corpus), input, source, 6000, report);
  expect(batches.every(b => estimateTokens(JSON.stringify(b)) <= 6000)).toBe(true);
  const names = batches.flatMap(b => b.people.map(p => p.name));
  expect(names).toEqual(expect.arrayContaining(["ben", "host@example.test", "maya"]));
  const host = batches.find(b => b.people.some(p => p.name === "host@example.test"))!;
  expect(host.people).toHaveLength(1);
  const ids = host.meetings.flatMap(m => m.segments.map(s => s.id));
  expect(ids).toContain("busy2-own");
  expect(ids).toContain("busy2-before");
  expect(ids).toContain("busy2-after");
  expect(ids).not.toContain("busy2-other-0");
  const hostId = host.people[0].id;
  expect(report.trimmed).toContain(hostId);
  expect(report.skipped).not.toContain(hostId);
});

it("keeps the most recent meetings when a focused history is still too large", async () => {
  const build = await recentPeople();
  const busy = Array.from({ length: 6 }, (_, i) => longMeeting(`m${i}`, `2026-10-0${i + 1}T12:00:00Z`, "host@example.test", `Statement ${i} `.repeat(60), 2));
  const report = { trimmed: [] as string[], skipped: [] as string[] };
  const batches = build(busy, buildCatalog(busy), input, source, 1500, report);
  expect(batches.every(b => estimateTokens(JSON.stringify(b)) <= 1500)).toBe(true);
  const host = batches.find(b => b.people.some(p => p.name === "host@example.test"))!;
  expect(host.people).toHaveLength(1);
  expect(report.trimmed).toContain(host.people[0].id);
  const kept = host.meetings.map(m => m.id);
  expect(kept.length).toBeLessThan(6);
  expect(kept).toContain("m5");
  expect(kept).not.toContain("m0");
  expect(kept).toEqual([...kept].sort());
});

it("skips a candidate whose single newest statement cannot fit and still searches everyone else", async () => {
  const build = await recentPeople();
  const huge = longMeeting("huge", "2026-10-01T12:00:00Z", "host@example.test", "Long statement ".repeat(800), 1);
  const corpus = [huge, meeting("maya")];
  const report = { trimmed: [] as string[], skipped: [] as string[] };
  const batches = build(corpus, buildCatalog(corpus), input, source, 4000, report);
  const catalog = buildCatalog(corpus);
  expect(batches.flatMap(b => b.people.map(p => p.name))).toContain("maya");
  expect(batches.flatMap(b => b.people.map(p => p.name))).not.toContain("host@example.test");
  expect(report.skipped).toContain(catalog.people.find(p => p.name === "host@example.test")!.id);
});

it("still refuses when the selected input person alone is too large", async () => {
  const build = await recentPeople();
  const huge = longMeeting("huge", "2026-10-01T12:00:00Z", "host@example.test", "Long statement ".repeat(800), 1);
  const corpus = [huge, meeting("maya")];
  const catalog = buildCatalog(corpus);
  const host = catalog.people.find(p => p.name === "host@example.test")!;
  expect(() => build(corpus, catalog, { kind: "person", ids: [host.id] }, source, 4000)).toThrow("history is too large");
});

it("sizes batches by tokens so Chinese transcripts stay inside Jev's limit", async () => {
  const build = await recentPeople();
  const zh = (id: string, speaker: string) => ({ ...meeting(id, speaker), segments: [{ id: `${id}-s`, startMs: 0, speaker, text: "我们需要更多的算力和数据中心".repeat(300) }] });
  const corpus = [zh("a", "alex"), zh("b", "maya"), zh("c", "ben")];
  const batches = build(corpus, buildCatalog(corpus), input, source, 9000);
  expect(batches.every(b => estimateTokens(JSON.stringify(b)) <= 9000)).toBe(true);
  expect(batches.length).toBeGreaterThan(1);
  expect(JSON.stringify(batches[0]).length).toBeLessThan(9000 * 1.2);
});

it("keeps the latest passages of one meeting too long to send whole", async () => {
  const build = await recentPeople();
  const long: IntelMeeting = { ...meeting("long", "host@example.test"), segments: [
    ...Array.from({ length: 200 }, (_, i) => ({ id: `long-${i}`, startMs: i, speaker: "host@example.test", text: `We need GPU capacity, update ${i}. `.repeat(4) })),
    { id: "long-last", startMs: 999, speaker: "host@example.test", text: "Update: we no longer need GPU capacity." },
  ] };
  const report = { trimmed: [] as string[], skipped: [] as string[] };
  const batches = build([long, meeting("maya")], buildCatalog([long, meeting("maya")]), input, source, 3000, report);
  const host = batches.find(b => b.people.some(p => p.name === "host@example.test"))!;
  expect(report.skipped).toHaveLength(0);
  expect(estimateTokens(JSON.stringify(host))).toBeLessThanOrEqual(3000);
  const ids = host.meetings[0].segments.map(s => s.id);
  expect(ids.at(-1)).toBe("long-last");
  expect(ids).not.toContain("long-0");
});
