import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ emitTelemetryLog: vi.fn(), loadIntelMeetings: vi.fn(), scoreIntelBatch: vi.fn(), verifyIntelClaims: vi.fn(), assertWorkspaceHasProviderCredit: vi.fn(), resolveIntelContent: vi.fn() }));
vi.mock("@/lib/intel/store", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/intel/store")>(), loadIntelMeetings: mocks.loadIntelMeetings }));
vi.mock("@/lib/telemetry/server", () => mocks);
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/meeting-composition", () => ({}));
vi.mock("@/lib/intel/generation", () => ({ INTEL_MODEL: "typesafe/jev-router" }));
vi.mock("@/lib/intel/verification", () => mocks);
vi.mock("@/lib/intel/scoring", () => mocks);
vi.mock("@/lib/provider-credit", () => mocks);
vi.mock("@/lib/intel/content", () => ({ ...mocks, IntelInputError: class extends Error {} }));
import { searchIntel } from "@/lib/intel/search";
import { buildCatalog, intelSourceHash } from "@/lib/intel/provenance";
import type { IntelMeeting } from "@/lib/intel/types";
const m: IntelMeeting = { id: "m1", title: "Meeting", date: new Date().toISOString(), startedAt: null, status: "ready", transcriptJobStatus: null, aiIntel: null, aiFollowup: null, segments: [{ id: "s1", speaker: "Alex", text: "We need inference partners", startMs: 0 }] };
const workspace = { userId: "u", teamId: "t", domain: "example.com" };
beforeEach(() => { vi.clearAllMocks(); mocks.loadIntelMeetings.mockResolvedValue([m]); mocks.scoreIntelBatch.mockImplementation(async call => {
 const batch = call;
 return ({ matches: batch.people.map((p: {id:string; sourceSegmentId:string}) => ({id:p.id,type:"person",score:25,relevance:"related_focus",reason:"Background relevance",caveat:"No direct request",segmentIds:[p.sourceSegmentId],counterEvidenceIds:[]})) });
 }); mocks.verifyIntelClaims.mockResolvedValue([]); mocks.resolveIntelContent.mockResolvedValue({ text: "Actual article content about inference", url: "https://example.com/article" }); });
describe("Intel matching boundaries", () => {
 it("identifies a matching timeout without sending search or provider text to telemetry", async () => {
  mocks.scoreIntelBatch.mockRejectedValueOnce(new Error("timeout for confidential query"));
  await expect(searchIntel(workspace, { kind: "content", text: "inference" }, [m])).rejects.toThrow("timeout");
  const [event] = mocks.emitTelemetryLog.mock.calls[0];
  expect(event.attributes["operation.name"]).toBe("matching");
  expect(event.error.message).toBe("Intel search matching: timeout");
 });
 it("gives scoring resolved article content, not just the URL", async () => {
  await searchIntel(workspace, { kind: "content", text: "https://example.com/article" }, [m]);
  expect(mocks.scoreIntelBatch.mock.calls[0][0].source.text).toBe("Actual article content about inference");
 });
 it("keeps a selected intel source available while scoring another participant", async () => {
  const indexed = { ...m, aiIntel: { sourceHash: intelSourceHash(m), result: { items: [{ kind: "plan", text: "Alex needs inference partners", importance: "high", speakerSegmentId: "s1", segmentIds: ["s1"] }] } } };
  const recipient = { ...m, id: "m2", segments: [{ ...m.segments[0], id:"s2", speaker:"Maya" }] };
  mocks.loadIntelMeetings.mockResolvedValue([indexed, recipient]);
  const input = { kind: "intel" as const, id: buildCatalog([indexed]).intel[0].id };
  await searchIntel(workspace, input, [indexed, recipient]);
  expect(mocks.scoreIntelBatch.mock.calls[0][0].intel[0].text).toBe("Alex needs inference partners");
 });
 it("rejects stale person selection before a provider call", async () => {
  await expect(searchIntel(workspace, { kind: "person", ids: ["revoked"] }, [m])).rejects.toThrow("no longer available");
  expect(mocks.scoreIntelBatch).not.toHaveBeenCalled();
 });
 it("rejects an appended reversal during the model call", async () => {
  mocks.loadIntelMeetings.mockResolvedValue([{ ...m, segments: [...m.segments, { id: "new", speaker: "Alex", text: "We no longer want inference partners.", startMs: 5000 }] }]);
  await expect(searchIntel(workspace, { kind: "content", text: "Inference" }, [m])).rejects.toThrow("access or content changed");
 });
 it("rejects access revoked during the model call", async () => {
  mocks.loadIntelMeetings.mockResolvedValue([]);
  await expect(searchIntel(workspace, { kind: "content", text: "Inference" }, [m])).rejects.toThrow("access or content changed");
 });
});
it("searches all batches and rechecks the full archive after verification", async () => {
 const corpus = Array.from({ length: 3 }, (_,i) => ({ ...m, id: `m${i}`, segments: [{ ...m.segments[0], id: `s${i}`, speaker: `Person ${i}`, text: "Inference evidence ".repeat(20000) }] }));
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 const progress = vi.fn();
 const result = await searchIntel(workspace, { kind: "content", text: "Inference" }, corpus, progress);
 expect(progress.mock.calls).toEqual([[0,3], [1,3], [2,3], [3,3]]);
 expect(mocks.scoreIntelBatch).toHaveBeenCalledTimes(3);
 expect(mocks.verifyIntelClaims).not.toHaveBeenCalled();
 expect(result.catalog.people).toHaveLength(3);
 const searched = mocks.scoreIntelBatch.mock.calls.flatMap(([call]) => call.meetings.map((meeting: { id: string }) => meeting.id));
 expect(searched).toEqual(["m0", "m1", "m2"]);
});
it("rejects unsupported attribution rather than publishing fabricated scores", async () => {
 const corpus = [m, { ...m, id: "m2", segments: [{ ...m.segments[0], id: "s2", speaker: "Maya" }] }];
 const people = buildCatalog(corpus).people;
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.verifyIntelClaims.mockImplementation(async claims => claims);
 mocks.scoreIntelBatch.mockResolvedValue(({ matches: [
   { id: people[0].id, type: "person", score: 40, relevance: "related_focus", reason: "Wrong attribution", caveat: "", segmentIds: ["s2"], counterEvidenceIds: [] },
   { id: people[1].id, type: "person", score: 40, relevance: "related_focus", reason: "Supported interest", caveat: "", segmentIds: ["s2"], counterEvidenceIds: [] },
 ] }));
 await expect(searchIntel(workspace, { kind: "content", text: "Inference" }, corpus)).rejects.toThrow("Evidence does not support this person");
 expect(mocks.verifyIntelClaims).not.toHaveBeenCalled();
});
it("allows background indexing to add intel without invalidating unchanged source evidence", async () => {
 const indexed = { ...m, aiIntel: { sourceHash: intelSourceHash(m), result: { items: [{ kind: "plan", text: "Alex needs inference partners", importance: "high", speakerSegmentId: "s1", segmentIds: ["s1"] }] } } };
 mocks.loadIntelMeetings.mockResolvedValue([indexed]);
 const result = await searchIntel(workspace, { kind: "content", text: "Inference" }, [m]);
 expect(result.catalog.intel).toHaveLength(1);
});
it("still rejects replacement of the selected intel record during matching", async () => {
 const item = { kind: "plan", text: "Alex needs inference partners", importance: "high", speakerSegmentId: "s1", segmentIds: ["s1"] };
 const indexed = { ...m, aiIntel: { sourceHash: intelSourceHash(m), result: { items: [item] } } };
 mocks.loadIntelMeetings.mockResolvedValue([{ ...indexed, aiIntel: { ...indexed.aiIntel, result: { items: [{ ...item, text: "A different extracted item" }] } } }]);
 const recipient = { ...m, id: "other", segments:[{...m.segments[0],id:"other-s",speaker:"Other"}] };
 await expect(searchIntel(workspace, { kind: "intel", id: buildCatalog([indexed]).intel[0].id }, [indexed,recipient])).rejects.toThrow("access or content changed");
});
