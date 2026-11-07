import { expect, it } from "vitest";
import { retrieveSearchMeetings } from "@/lib/intel/retrieval";
import { buildCatalog } from "@/lib/intel/provenance";
import type { IntelMeeting } from "@/lib/intel/types";
function meeting(id: string, text: string, speaker = id): IntelMeeting {
 return { id, title: id, date: new Date().toISOString(), startedAt: null, status: "ready", transcriptJobStatus: null, aiIntel: null, aiFollowup: null,
 segments: [{ id: `${id}-s`, startMs: 0, speaker, text }] };
}
const input = { kind: "content" as const, text: "Inference infrastructure partners" };
it("retrieves relevant evidence from anywhere in the archive, not just recent meetings", () => {
 const corpus = [meeting("recent", "Lunch plans"), meeting("old", "We need inference infrastructure partners")];
 corpus[1].date = "2020-01-01T00:00:00Z";
 expect(retrieveSearchMeetings(corpus, buildCatalog(corpus), input, input.text, 1).map(m => m.id)).toEqual(["old"]);
});
it("includes later changed positions for a retrieved confirmed identity", () => {
 const corpus = [meeting("old", "Inference infrastructure partners", "alex@example.test"), meeting("new", "We no longer work in that sector", "alex@example.test"), meeting("other", "Lunch")];
 expect(retrieveSearchMeetings(corpus, buildCatalog(corpus), input, input.text, 1).map(m => m.id)).toEqual(["old", "new"]);
});
it("uses the selected person's evidence instead of their name to retrieve matches", () => {
 const corpus = [meeting("source", "We need inference infrastructure partners", "Alex"), meeting("target", "Our inference infrastructure supports partners"), meeting("namesake", "Alex likes cooking")];
 const catalog = buildCatalog(corpus);
 expect(retrieveSearchMeetings(corpus, catalog, {kind:"person",ids:[catalog.people[0].id]}, "Alex", 1).map(m => m.id)).toEqual(["source", "target"]);
});
it("segments Chinese queries and avoids unrelated fallback results", () => {
 const corpus = [meeting("a", "我们需要推理基础设施合作伙伴"), meeting("b", "午饭吃什么")];
 expect(retrieveSearchMeetings(corpus, buildCatalog(corpus), input, "推理基础设施", 1).map(m => m.id)).toEqual(["a"]);
 expect(retrieveSearchMeetings(corpus, buildCatalog(corpus), input, "Astronomy", 1)).toEqual([]);
});
it("lets the model check a small corpus even without exact shared words", () => {
 const corpus = [meeting("a", "我们提供闲置显卡托管服务"), meeting("b", "Lunch plans")];
 expect(retrieveSearchMeetings(corpus, buildCatalog(corpus), input, "GPU hosting").map(m => m.id)).toEqual(["a", "b"]);
});
