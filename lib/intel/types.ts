import { z } from "zod";

export const intelItemSchema = z.strictObject({
  kind: z.enum(["reported_fact", "anecdote", "plan", "opinion", "insight", "number"]),
  text: z.string().trim().min(1).max(500),
  importance: z.enum(["high", "normal"]),
  speakerSegmentId: z.string().min(1),
  segmentIds: z.array(z.string().min(1)).min(1).max(5),
});
export const intelExtractionSchema = z.strictObject({ items: z.array(intelItemSchema).max(40) });
export type IntelItem = z.infer<typeof intelItemSchema>;
export type Segment = { id: string; speaker: string | null; text: string; startMs: number };
export type IntelMeeting = {
  id: string; title: string; date: string; startedAt: string | null;
  status: string; transcriptJobStatus: string | null;
  followupSource?: { title: string; startedAt: string | null; segments: Segment[] };
  segments: Segment[]; aiIntel: unknown; aiFollowup: unknown;
};
export type Evidence = Segment & { meetingId: string; meetingTitle: string; date: string };
export type Person = {
  id: string; name: string; detail: string; kind: "participant" | "mentioned";
  meetingIds: string[]; segmentIds: string[]; relationship?: string; sourceDate: string; sourceMeetingId: string; sourceSegmentId: string;
};
export type IntelCard = IntelItem & { id: string; date: string; speaker: string; evidence: Evidence[] };
export const searchInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("content"), text: z.string().trim().min(3).max(20000) }),
  z.strictObject({ kind: z.literal("intel"), id: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal("person"), ids: z.array(z.string().min(1).max(300)).min(1).max(20) }),
]);
export type SearchInput = z.infer<typeof searchInputSchema>;
export const rankingSchema = z.strictObject({
  matches: z.array(z.strictObject({
    id: z.string(), type: z.enum(["person", "intel"]),
    relevance: z.enum(["expressed_interest", "related_focus", "possible_synergy"]),
    reason: z.string().min(1).max(600),
    caveat: z.string().max(500),
    segmentIds: z.array(z.string()).min(1).max(6),
    counterEvidenceIds: z.array(z.string()).max(4),
  })).max(12),
});
export type Match = z.infer<typeof rankingSchema>["matches"][number] & {
  title: string; detail: string; evidence: Evidence[]; counterEvidence: Evidence[];
};
export type SearchResult = { matches: Match[]; source: { text: string; url?: string }; coverage: string; historyId?: string; historyWarning?: string; catalog?: IntelBrowserCatalog };
export type HistoryEntry = { savedJob?: boolean; id: string; input: SearchInput; label: string; createdAt: string };
export type IntelCatalog = { intel: IntelCard[]; people: Person[]; coverage: string; pending: number };
export const relevanceLabels = { expressed_interest: "Expressed interest", related_focus: "Related focus", possible_synergy: "Possible synergy" };
export const kindLabels = { reported_fact: "Reported fact", anecdote: "Anecdote", plan: "Plan", opinion: "Opinion", insight: "AI insight", number: "Number" };

export type IntelBrowserPerson = Omit<Person, "segmentIds">;
export type IntelBrowserCatalog = Omit<IntelCatalog, "people"> & { people: IntelBrowserPerson[] };
