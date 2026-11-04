import { describe, expect, it } from "vitest";
import { buildCatalog, buildMatchingContext, currentIntel, intelSourceHash, personId, validateExtraction, validateMatches } from "@/lib/intel/provenance";
import type { IntelMeeting } from "@/lib/intel/types";
const now = new Date();
const meeting = (id = "m1", speaker = "Alex"): IntelMeeting => ({ id, title: `Meeting ${id}`, startedAt: now.toISOString(), date: now.toISOString(), status: "ready", transcriptJobStatus: null, aiIntel: null, aiFollowup: null, segments: [{ id: `${id}s1`, speaker, text: "We are looking for inference partners.", startMs: 10000 }] });
const item = { kind: "plan", text: "Alex seeks inference partners.", importance: "high", speakerSegmentId: "m1s1", segmentIds: ["m1s1"] };
function indexed() { const m = meeting(); m.aiIntel = { sourceHash: intelSourceHash(m), result: { items: [item] } }; return m; }
describe("Intel provenance and identities", () => {
  it("never merges names across meetings; exact email labels combine", () => {
    expect(buildCatalog([meeting(), meeting("m2")]).people).toHaveLength(2);
    expect(buildCatalog([meeting("m1", "a@example.com"), meeting("m2", "A@example.com")]).people).toHaveLength(1);
    expect(buildCatalog([meeting("m1", "a@example.com"), meeting("m2", "b@example.com")]).people).toHaveLength(2);
  });
  it("does not fabricate a person from a generic speaker", () => {
    expect(buildCatalog([meeting("m1", "Speaker 1")]).people).toHaveLength(0);
  });
  it("rejects unknown segments and attribution absent from citations", () => {
    expect(() => validateExtraction({ items: [{ ...item, segmentIds: ["missing"] }] }, meeting())).toThrow();
    expect(() => validateExtraction({ items: [{ ...item, speakerSegmentId: "missing" }] }, meeting())).toThrow();
  });
  it("invalidates extracted intel after replacement or speaker corrections", () => {
    const m = indexed(); expect(currentIntel(m)?.items).toHaveLength(1);
    m.segments[0].speaker = "Different person"; expect(currentIntel(m)).toBeNull();
    expect(buildCatalog([m]).intel).toHaveLength(0);
  });
  it("builds exact quotes and source URLs from records rather than model text", () => {
    const m = indexed(); const result = validateMatches({ matches: [{ id: personId("m1", "Alex"), type: "person", relevance: "expressed_interest", reason: "Seeks inference partners.", caveat: "", segmentIds: ["m1s1"], counterEvidenceIds: [] }] }, { kind: "content", text: "Inference infrastructure" }, [m]);
    expect(result[0].evidence[0].text).toBe(m.segments[0].text);
    expect(result[0].evidence[0].startMs).toBe(10000);
  });
  it("rejects a result citing someone else's statements", () => {
    const m = meeting(); const other = meeting("m2", "Bea");
    expect(() => validateMatches({ matches: [{ id: personId("m1", "Alex"), type: "person", relevance: "expressed_interest", reason: "Seeks partners", caveat: "", segmentIds: ["m2s1"], counterEvidenceIds: [] }] }, { kind: "content", text: "Inference" }, [m, other])).toThrow("Evidence does not support");
  });
  it("rejects revoked sources, invented counterevidence and stale targets", () => {
    const match = { id: personId("m1", "Alex"), type: "person", relevance: "related_focus", reason: "Related", caveat: "", segmentIds: ["m1s1"], counterEvidenceIds: ["revoked"] };
    expect(() => validateMatches({ matches: [match] }, { kind: "content", text: "Inference" }, [meeting()])).toThrow();
    expect(() => validateMatches({ matches: [{ ...match, counterEvidenceIds: [] }] }, { kind: "content", text: "Inference" }, [])).toThrow();
  });
  it("requires evidence for both selected person and suggested target", () => {
    const m = indexed(); const other = meeting("m2", "Bea");
    const match = { id: buildCatalog([m]).intel[0].id, type: "intel", relevance: "possible_synergy", reason: "Could help", caveat: "Inferred", segmentIds: ["m1s1"], counterEvidenceIds: [] };
    expect(() => validateMatches({ matches: [match] }, { kind: "person", ids: [personId("m2", "Bea")] }, [m, other])).toThrow("Missing evidence");
  });
  it("includes initial/latest context and all recent meetings but excludes old middle meetings", () => {
    const dated = (id: string, date: string) => ({ ...meeting(id, "a@example.com"), date, startedAt: date });
    const corpus = [dated("first", "2024-01-01T00:00:00Z"), dated("middle", "2024-02-01T00:00:00Z"), dated("recent", "2026-09-01T00:00:00Z"), dated("latest", "2026-10-01T00:00:00Z")];
    expect(buildMatchingContext(corpus, buildCatalog(corpus).people, new Date("2026-11-03")).map(m => m.id)).toEqual(["first", "recent", "latest"]);
  });
});
it("does not recommend an intel card's own speaker as its recipient", () => {
 const m = indexed(); const catalog = buildCatalog([m]);
 expect(() => validateMatches({ matches: [{ id: catalog.people[0].id, type: "person", relevance: "expressed_interest", reason: "Interested", caveat: "", segmentIds: ["m1s1"], counterEvidenceIds: [] }] }, { kind: "intel", id: catalog.intel[0].id }, [m])).toThrow("source speaker");
});
