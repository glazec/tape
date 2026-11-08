import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ loadIntelMeetings: vi.fn(), scoreIntelBatch: vi.fn(), verifyIntelClaims: vi.fn(), assertWorkspaceHasProviderCredit: vi.fn(), resolveIntelContent: vi.fn() }));
vi.mock("@/lib/intel/store", async original => ({ ...await original<typeof import("@/lib/intel/store")>(), loadIntelMeetings: mocks.loadIntelMeetings }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/meeting-composition", () => ({}));
vi.mock("@/lib/intel/generation", () => ({ INTEL_MODEL: "typesafe/jev-router" }));
vi.mock("@/lib/intel/verification", () => mocks);
vi.mock("@/lib/intel/scoring", () => mocks);
vi.mock("@/lib/provider-credit", () => mocks);
vi.mock("@/lib/telemetry/server", () => ({ emitTelemetryLog: vi.fn() }));
vi.mock("@/lib/intel/content", () => ({ ...mocks, IntelInputError: class extends Error {} }));
import { prepareIntelSearch, searchIntel } from "@/lib/intel/search";
import type { IntelMeeting } from "@/lib/intel/types";
const now = new Date("2026-11-05T12:00:00Z");
function meeting(id: string, date = "2026-10-05T12:00:00Z", speaker = id): IntelMeeting {
 return { id, title: id, date, startedAt: date, status: "ready", transcriptJobStatus: null, aiIntel: null, aiFollowup: null,
  segments: [{ id: `${id}-s`, speaker, text: "完全不同的背景与需求", startMs: 0 }] };
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); mocks.resolveIntelContent.mockResolvedValue({ text: "GPU infrastructure" }); });
it("considers every recent participant regardless of keyword overlap and retains full notes", async () => {
 const corpus = Array.from({length: 25}, (_, i) => ({ ...meeting(`p${i}`), notes: { content: `Full notes ${i}`, blocks: null } }));
 corpus.push({ ...meeting("old", "2026-08-04T12:00:00Z"), notes: { content: "old", blocks: null } });
 const plan = await prepareIntelSearch({kind: "content", text: "GPU infrastructure"}, corpus);
 const people = plan.batches.flatMap(b => b.people);
 expect(new Set(people.map(p => p.name)).size).toBe(25);
 expect(people.some(p => p.name === "old")).toBe(false);
 expect(plan.batches.every(b => b.people.length <= 12)).toBe(true);
 expect(plan.batches.flatMap(b => b.meetings).find(m => m.id === "p0")).toHaveProperty("notes.content", "Full notes 0");
});
it("keeps the full recent history for a confirmed identity without duplicating its candidacy", async () => {
 const corpus = [meeting("first", "2026-08-05T12:00:00Z", "alex@example.test"), meeting("middle", "2026-09-05T12:00:00Z", "alex@example.test"), meeting("last", "2026-11-04T12:00:00Z", "alex@example.test")];
 const plan = await prepareIntelSearch({kind:"content", text:"GPU infrastructure"}, corpus);
 expect(plan.batches.flatMap(b => b.people)).toHaveLength(1);
 expect(plan.batches[0].meetings.map(m => m.id)).toEqual(["first", "middle", "last"]);
});
it("ranks all candidates numerically, retains zero scores and never invokes the acceptance verifier", async () => {
 const corpus = Array.from({length:25}, (_, i) => meeting(`p${i}`));
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.scoreIntelBatch.mockImplementation(async call => {
  const batch = call;
  return ({ matches: batch.people.map((p: {id:string;name:string;sourceSegmentId:string}) => ({id:p.id,type:"person",score:Number(p.name.slice(1)),relevance:"related_focus",reason:"Limited relevance in the supplied background",caveat:"No direct request",segmentIds:[p.sourceSegmentId],counterEvidenceIds:[]})) });
 });
 const result = await searchIntel({teamId:"t",userId:"u",domain:"example.test"}, {kind:"content",text:"GPU infrastructure"},corpus);
 expect(result.matches).toHaveLength(25);
 expect(result.matches.map(m => m.title)).toEqual(Array.from({length:25},(_,i)=>`p${24-i}`));
 expect(result.matches.at(-1)).toHaveProperty("score",0);
 expect(mocks.verifyIntelClaims).not.toHaveBeenCalled();
 expect(mocks.scoreIntelBatch).toHaveBeenCalledTimes(3);
});
it("preserves uncited transcript passages alongside notes", async () => {
 const m = { ...meeting("alex"), notes: { content:"Entire background including requests and offers", blocks:[{id:"b", text:"Entire background including requests and offers", answer:{ sources:[{segmentId:"offer"}] }}] },
  segments: [meeting("alex").segments[0], {id:"noise",speaker:"alex",text:"Long unrelated transcript",startMs:1},{id:"offer",speaker:"alex",text:"We offer GPU capacity",startMs:2}] };
 const plan = await prepareIntelSearch({kind:"content",text:"GPU infrastructure"},[m]);
 expect(plan.batches[0].meetings[0].notes).toEqual(m.notes);
 expect(plan.batches[0].meetings[0].segments.map(s=>s.id)).toEqual(["alex-s","noise","offer"]);
});
it("fails visibly if the model omits a candidate rather than silently filtering them", async () => {
 const corpus = [meeting("alex")]; mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.scoreIntelBatch.mockResolvedValue({matches:[]});
 await expect(searchIntel({teamId:"t",userId:"u",domain:"example.test"},{kind:"content",text:"GPU infrastructure"},corpus)).rejects.toThrow("Incomplete candidate scores");
});
it("invalidates results if private background notes change while scoring", async () => {
 const m = {...meeting("alex"),notes:{content:"Original full background",blocks:null}};
 mocks.loadIntelMeetings.mockResolvedValue([{...m,notes:{content:"Changed background",blocks:null}}]);
 mocks.scoreIntelBatch.mockImplementation(async call => {
  const p=call.people[0];
  return ({matches:[{id:p.id,type:"person",score:0,relevance:"related_focus",reason:"No relevant connection",caveat:"",segmentIds:[p.sourceSegmentId],counterEvidenceIds:[]}]});
 });
 await expect(searchIntel({teamId:"t",userId:"u",domain:"example.test"},{kind:"content",text:"GPU infrastructure"},[m])).rejects.toThrow("access or content changed");
});
it("clamps the three month window at month end and excludes future meetings", async () => {
 vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
 const corpus=[meeting("boundary","2026-02-28T00:00:00Z"),meeting("old","2026-02-27T23:59:59Z"),meeting("future","2026-06-01T00:00:00Z")];
 const plan=await prepareIntelSearch({kind:"content",text:"GPU infrastructure"},corpus);
 expect(plan.batches.flatMap(b=>b.people.map(p=>p.name))).toEqual(["boundary"]);
});
it("retries only omitted candidates once and preserves scores already returned", async () => {
 const corpus=[meeting("alex"),meeting("maya")];mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.scoreIntelBatch.mockImplementation(async call=>{
  const people=call.people;
  const p=people[0];
  return ({matches:[{id:p.id,type:"person",score:0,relevance:"related_focus",reason:"No clear connection",caveat:"",segmentIds:[p.sourceSegmentId],counterEvidenceIds:[]}]});
 });
 const result=await searchIntel({teamId:"t",userId:"u",domain:"example.test"},{kind:"content",text:"GPU infrastructure"},corpus);
 expect(result.matches).toHaveLength(2);
 expect(mocks.scoreIntelBatch).toHaveBeenCalledTimes(2);
 expect(mocks.scoreIntelBatch.mock.calls[1][0].people.map((p:{name:string})=>p.name)).toEqual(["maya"]);
});
it("discloses focused histories in the coverage note instead of failing the search", async () => {
 const long = (id: string) => ({ ...meeting(id, "2026-10-20T12:00:00Z", "host@example.test"),
  segments: [{ id: `${id}-s`, speaker: "host@example.test", text: "Recurring host update ".repeat(12000), startMs: 0 }] });
 const corpus = [long("a"), long("b"), meeting("maya")];
 const plan = await prepareIntelSearch({kind:"content",text:"GPU infrastructure"}, corpus);
 expect(plan.batches.flatMap(b => b.people.map(p => p.name))).toEqual(expect.arrayContaining(["host@example.test", "maya"]));
 expect(plan.coverage).toContain("For 1 person with very long histories");
});
it("scores batches in parallel up to the per search limit", async () => {
 const corpus = Array.from({length: 12 * 20}, (_, i) => meeting(`p${i}`));
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 let inFlight = 0, peak = 0;
 mocks.scoreIntelBatch.mockImplementation(async call => {
  inFlight++; peak = Math.max(peak, inFlight);
  await new Promise(r => setTimeout(r, 5));
  inFlight--;
  return { matches: call.people.map((p: {id:string;sourceSegmentId:string}) => ({id:p.id,type:"person",score:0,relevance:"related_focus",reason:"No clear connection",caveat:"",segmentIds:[p.sourceSegmentId],counterEvidenceIds:[]})) };
 });
 await searchIntel({teamId:"t",userId:"u",domain:"example.test"},{kind:"content",text:"GPU infrastructure"},corpus);
 expect(mocks.scoreIntelBatch).toHaveBeenCalledTimes(20);
 expect(peak).toBe(8);
});
it("splits a batch Jev refuses for size and still ranks everyone", async () => {
 const { JevRequestTooLargeError } = await import("@/lib/intel/tokens");
 const corpus = Array.from({length: 8}, (_, i) => meeting(`p${i}`));
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.scoreIntelBatch.mockImplementation(async call => {
  if (call.people.length > 2) throw new JevRequestTooLargeError("too large");
  expect(call.meetings.length).toBe(call.people.length);
  return { matches: call.people.map((p: {id:string;sourceSegmentId:string}) => ({id:p.id,type:"person",score:0,relevance:"related_focus",reason:"No clear connection",caveat:"",segmentIds:[p.sourceSegmentId],counterEvidenceIds:[]})) };
 });
 const result = await searchIntel({teamId:"t",userId:"u",domain:"example.test"},{kind:"content",text:"GPU infrastructure"},corpus);
 expect(result.matches).toHaveLength(8);
});
it("skips one person who cannot fit any request instead of failing the search", async () => {
 const { JevRequestTooLargeError } = await import("@/lib/intel/tokens");
 const corpus = [meeting("huge"), meeting("maya")];
 mocks.loadIntelMeetings.mockResolvedValue(corpus);
 mocks.scoreIntelBatch.mockImplementation(async call => {
  if (call.people.some((p: {name:string}) => p.name === "huge")) throw new JevRequestTooLargeError("too large");
  return { matches: call.people.map((p: {id:string;sourceSegmentId:string}) => ({id:p.id,type:"person",score:0,relevance:"related_focus",reason:"No clear connection",caveat:"",segmentIds:[p.sourceSegmentId],counterEvidenceIds:[]})) };
 });
 const result = await searchIntel({teamId:"t",userId:"u",domain:"example.test"},{kind:"content",text:"GPU infrastructure"},corpus);
 expect(result.matches.map(m => m.title)).toEqual(["maya"]);
});
