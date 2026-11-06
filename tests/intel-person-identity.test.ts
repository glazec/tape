import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildCatalog, intelSourceHash, validateMatches } from "@/lib/intel/provenance";
import { buildSearchBatches } from "@/lib/intel/search-batches";
import type { IntelMeeting } from "@/lib/intel/types";
const make = (id: string, person: string | null, group = id): IntelMeeting => ({
  id, title: id, date: new Date().toISOString(), startedAt: null, status: "ready", transcriptJobStatus: null,
  aiIntel: null, aiFollowup: null, segments: [{ id: `${id}s`, speaker: "Alex", sourceSpeaker: "Speaker 1", personId: person, meetingSpeakerId: group, text: "We need inference partners", startMs: 0 }],
});
it("combines confirmed people across meetings while keeping identical names separate", () => {
  const corpus = [make("a", "person1"), make("b", "person1"), make("c", "person2")];
  const people = buildCatalog(corpus).people;
  expect(people).toHaveLength(2);
  expect(people[0].meetingIds).toEqual(["a", "b"]);
  expect(buildCatalog([make("a", null), make("b", null)]).people).toHaveLength(2);
});
it("does not infer identity from shared email labels after migration", () => {
  const corpus = [make("a", null), make("b", null)];
  corpus.forEach(m => { m.segments[0].speaker = "team@example.com"; });
  expect(buildCatalog(corpus).people).toHaveLength(2);
});
it("preserves legacy source hashes through metadata and preferred name edits", () => {
  const m = make("a", "person1");
  const legacy = [{ id: "as", speaker: "Speaker 1", text: "We need inference partners", startMs: 0 }];
  const hash = createHash("sha256").update(JSON.stringify([1, "a", null, legacy])).digest("hex");
  expect(intelSourceHash(m)).toBe(hash);
  m.segments[0].speaker = "Alex Chen";
  expect(intelSourceHash(m)).toBe(hash);
  m.attributionRevision = 1;
  expect(intelSourceHash(m)).not.toBe(hash);
});
it("keeps candidate segment membership in model input for identical names", () => {
  const corpus = [make("a", "person1"), make("b", "person2")];
  const batches = buildSearchBatches(corpus, buildCatalog(corpus), {kind:"content",text:"Inference partners"}, {text:"Inference partners"});
  expect(batches[0].people[0].segmentIds).toEqual(["as"]);
});
it("excludes the confirmed source person using the actual speaker anchor", () => {
  const a = make("a", "person1"), b = make("b", "person1");
  a.aiIntel = {sourceHash:intelSourceHash(a),result:{items:[{kind:"plan",text:"Need partners",importance:"high",speakerSegmentId:"as",segmentIds:["as"]}]}};
  const catalog = buildCatalog([a,b]);
  expect(() => validateMatches({matches:[{id:catalog.people[0].id,type:"person",relevance:"expressed_interest",reason:"Partners",caveat:"",segmentIds:["bs"],counterEvidenceIds:[]}]}, {kind:"intel",id:catalog.intel[0].id}, [a,b])).toThrow("source speaker");
});
