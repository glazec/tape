import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app-shell";
import { IntelSearch } from "@/components/intel-search";
import type { IntelCatalog, HistoryEntry, Person } from "@/lib/intel/types";
const evidence = { id: "s1", meetingId: "m1", meetingTitle: "Infrastructure roundtable", date: "2026-11-02T12:00:00Z", speaker: "Alex Chen", text: "We want to work with inference teams who already have enterprise customers. Security approval is what slows us down.", startMs: 432000 };
const mayaEvidence = { ...evidence, id: "s3", meetingId: "m3", meetingTitle: "Product and distribution", speaker: "Maya Patel", text: "Two of our enterprise pilots stalled in security review. We want partners who can help them reach production." };
const people: Person[] = [
 { id: "alex", name: "Alex Chen", detail: "Infrastructure roundtable", kind: "participant", meetingIds: ["m1"], segmentIds: ["s1"], sourceDate: evidence.date, sourceMeetingId: "m1", sourceSegmentId: "s1" },
 { id: "alex-other", name: "Alex Chen", detail: "Enterprise AI discussion", kind: "participant", meetingIds: ["m2"], segmentIds: ["s2"], sourceDate: "2026-10-12T12:00:00Z", sourceMeetingId: "m2", sourceSegmentId: "s2" },
 { id: "maya", name: "Maya Patel", detail: "Product and distribution", kind: "participant", meetingIds: ["m3"], segmentIds: ["s3"], sourceDate: evidence.date, sourceMeetingId: "m3", sourceSegmentId: "s3" },
 { id: "contact", name: "Unnamed infrastructure contact", detail: "Mentioned by Alex · Advises teams on enterprise security", kind: "mentioned", relationship: "knows", meetingIds: ["m1"], segmentIds: ["s1"], sourceDate: evidence.date, sourceMeetingId: "m1", sourceSegmentId: "s1" },
];
const catalog: IntelCatalog = { people, pending: 0, coverage: "Fictional fixture: four accessible meetings. No live meeting data.", intel: [
 { id: "i1", kind: "plan", importance: "high", text: "Alex is looking for inference teams with enterprise customers.", speaker: "Alex Chen", date: evidence.date, evidence: [evidence], speakerSegmentId: "s1", segmentIds: ["s1"] },
 { id: "i2", kind: "anecdote", importance: "high", text: "Two enterprise pilots stalled during security approval, despite strong usage.", speaker: "Maya Patel", date: "2026-10-30T12:00:00Z", evidence: [{ ...evidence, speaker: "Maya Patel", text: "Two of our pilots stalled in security review." }], speakerSegmentId: "s1", segmentIds: ["s1"] },
 { id: "i3", kind: "opinion", importance: "normal", text: "Distribution is becoming a more durable advantage than model performance.", speaker: "Alex Chen", date: "2026-10-28T12:00:00Z", evidence: [evidence], speakerSegmentId: "s1", segmentIds: ["s1"] },
] };
const history: HistoryEntry[] = [{ id: "h0", label: "Enterprise inference", input: { kind: "content", text: "Enterprise inference" }, createdAt: evidence.date }, { id: "h2", label: "Who is building in Japan?", input: { kind: "content", text: "Who is building in Japan?" }, createdAt: evidence.date }];
let currentCatalog = catalog;
const newPerson: Person = { ...people[2], id: "new-person", name: "Jordan Lee", detail: "Newly indexed meeting" };
const newIntel = { ...catalog.intel[0], id: "new-intel", text: "A newly indexed opportunity for enterprise inference." };
window.fetch = async (_url, init) => {
 if (init?.method === "DELETE") return Response.json({ cleared: true });
 const input = JSON.parse(String(init?.body));
 if (input.text?.includes("fail")) return Response.json({ error: "Could not read this link. Paste the content to find interested people." }, { status: 422 });
 if (input.text === "newly indexed") currentCatalog = { ...catalog, people: [...people, newPerson], intel: [...catalog.intel, newIntel] };
 const targetPerson = currentCatalog.people.find(p => p.id === "new-person") ?? people[2];
 const targetIntel = currentCatalog.intel.find(i => i.id === "new-intel") ?? catalog.intel[0];
 return Response.json({ historyId: crypto.randomUUID(), source: { text: input.text ?? "Selected intel" }, coverage: catalog.coverage, catalog: currentCatalog, matches: [{ id: input.kind === "person" ? targetIntel.id : targetPerson.id, type: input.kind === "person" ? "intel" : "person", title: input.kind === "person" ? targetIntel.text : targetPerson.name, detail: "Infrastructure roundtable", relevance: "possible_synergy", reason: "Maya described security reviews as a barrier to enterprise adoption. Alex’s search for enterprise inference partners could be relevant to that problem.", caveat: "This is a suggested connection. Willingness to collaborate is unknown.", segmentIds: ["s1"], counterEvidenceIds: [], evidence: [mayaEvidence, evidence], counterEvidence: [] }] });
};
createRoot(document.getElementById("root")!).render(<AppShell activeHref="/intel" wide><IntelSearch catalog={catalog} initialHistory={history} /><p className="fixed bottom-2 right-3 rounded bg-background px-2 py-1 text-[10px] text-muted-foreground">Fictional review data</p></AppShell>);
