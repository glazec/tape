import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadIntelMeetings: vi.fn(), createOpenRouterChatCompletion: vi.fn(), verifyIntelClaims: vi.fn(), assertWorkspaceHasProviderCredit: vi.fn(), resolveIntelContent: vi.fn() }));
vi.mock("@/lib/intel/store", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/intel/store")>(), loadIntelMeetings: mocks.loadIntelMeetings }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/meeting-composition", () => ({}));
vi.mock("@/lib/intel/generation", () => ({ INTEL_MODEL: "typesafe/jev-router" }));
vi.mock("@/lib/intel/verification", () => mocks);
vi.mock("@/lib/vendors/openrouter", () => mocks);
vi.mock("@/lib/provider-credit", () => mocks);
vi.mock("@/lib/intel/content", () => ({ ...mocks, IntelInputError: class extends Error {} }));
import { searchIntel } from "@/lib/intel/search";
import { buildCatalog, intelSourceHash } from "@/lib/intel/provenance";
import type { IntelMeeting } from "@/lib/intel/types";
const m: IntelMeeting = { id: "m1", title: "Meeting", date: new Date().toISOString(), startedAt: null, status: "ready", transcriptJobStatus: null, aiIntel: null, aiFollowup: null, segments: [{ id: "s1", speaker: "Alex", text: "We need inference partners", startMs: 0 }] };
const workspace = { userId: "u", teamId: "t", domain: "example.com" };
beforeEach(() => { vi.clearAllMocks(); mocks.loadIntelMeetings.mockResolvedValue([m]); mocks.createOpenRouterChatCompletion.mockResolvedValue('{"matches":[]}'); mocks.verifyIntelClaims.mockResolvedValue([]); mocks.resolveIntelContent.mockResolvedValue({ text: "Actual article content about inference", url: "https://example.com/article" }); });
describe("Intel matching boundaries", () => {
 it("gives the verifier resolved article content, not just the URL", async () => {
  await searchIntel(workspace, { kind: "content", text: "https://example.com/article" }, [m]);
  expect(mocks.verifyIntelClaims.mock.calls[0][1].source.text).toBe("Actual article content about inference");
 });
 it("includes the selected intel record in the independent verification context", async () => {
  const indexed = { ...m, aiIntel: { sourceHash: intelSourceHash(m), result: { items: [{ kind: "plan", text: "Alex needs inference partners", importance: "high", speakerSegmentId: "s1", segmentIds: ["s1"] }] } } };
  mocks.loadIntelMeetings.mockResolvedValue([indexed]);
  const input = { kind: "intel" as const, id: buildCatalog([indexed]).intel[0].id };
  await searchIntel(workspace, input, [indexed]);
  expect(mocks.verifyIntelClaims.mock.calls[0][1].intel[0].text).toBe("Alex needs inference partners");
 });
 it("rejects stale person selection before a provider call", async () => {
  await expect(searchIntel(workspace, { kind: "person", ids: ["revoked"] }, [m])).rejects.toThrow("no longer available");
  expect(mocks.createOpenRouterChatCompletion).not.toHaveBeenCalled();
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
 const result = await searchIntel(workspace, { kind: "content", text: "Inference" }, corpus);
 expect(mocks.createOpenRouterChatCompletion).toHaveBeenCalledTimes(3);
 expect(mocks.verifyIntelClaims).toHaveBeenCalledTimes(3);
 expect(result.catalog.people).toHaveLength(3);
 const searched = mocks.createOpenRouterChatCompletion.mock.calls.flatMap(([call]) => JSON.parse(call.messages[1].content).meetings.map((meeting: { id: string }) => meeting.id));
 expect(searched).toEqual(["m0", "m1", "m2"]);
});
it("ranks verified candidates across batches without rewriting their claims", async () => {
 const corpus = Array.from({ length: 3 }, (_, i) => ({ ...m, id: `m${i}`, segments: Array.from({ length: 6 }, (_, j) => ({ id: `s${i}-${j}`, speaker: `Person ${i}-${j}`, text: "Inference evidence ".repeat(3300), startMs: j })) }));
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.verifyIntelClaims.mockImplementation(async claims => claims);
 mocks.createOpenRouterChatCompletion.mockImplementation(async call => {
   const payload = JSON.parse(call.messages[1].content);
   if (payload.candidates) return JSON.stringify({ indices: [17, 0] });
   return JSON.stringify({ matches: payload.people.map((p: { id: string; sourceSegmentId: string }) => ({ id: p.id, type: "person", relevance: "related_focus", reason: "Supported interest", caveat: "", segmentIds: [p.sourceSegmentId], counterEvidenceIds: [] })) });
 });
 const result = await searchIntel(workspace, { kind: "content", text: "Inference" }, corpus);
 expect(result.matches.map(m => m.title)).toEqual(["Person 2-5", "Person 0-0"]);
 expect(result.matches.every(m => m.reason === "Supported interest")).toBe(true);
 expect(mocks.createOpenRouterChatCompletion).toHaveBeenCalledTimes(4);
});
it("drops unsupported attribution before independently verifying valid candidates", async () => {
 const corpus = [m, { ...m, id: "m2", segments: [{ ...m.segments[0], id: "s2", speaker: "Maya" }] }];
 const people = buildCatalog(corpus).people;
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.verifyIntelClaims.mockImplementation(async claims => claims);
 mocks.createOpenRouterChatCompletion.mockResolvedValue(JSON.stringify({ matches: [
   { id: people[0].id, type: "person", relevance: "related_focus", reason: "Wrong attribution", caveat: "", segmentIds: ["s2"], counterEvidenceIds: [] },
   { id: people[1].id, type: "person", relevance: "related_focus", reason: "Supported interest", caveat: "", segmentIds: ["s2"], counterEvidenceIds: [] },
 ] }));
 const result = await searchIntel(workspace, { kind: "content", text: "Inference" }, corpus);
 expect(result.matches.map(m => m.title)).toEqual(["Maya"]);
 expect(mocks.verifyIntelClaims.mock.calls[0][0]).toHaveLength(1);
});
