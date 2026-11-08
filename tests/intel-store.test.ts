import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ select: vi.fn(), getComposedMeetingForFollowup: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/meeting-composition", () => mocks);
import { loadIntelMeetings } from "@/lib/intel/store";
import { buildCatalog } from "@/lib/intel/provenance";
import { getConnectionsSourceHash, getFollowupSourceHash } from "@/lib/meeting-followup-source";
import { PgDialect } from "drizzle-orm/pg-core";
const now = new Date();
const workspace = { teamId: "team", userId: "user", domain: "example.com" };
function query(rows: unknown[]) {
 const q = { from: vi.fn(), where: vi.fn(), innerJoin: vi.fn(), leftJoin: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), then: (resolve: (value: unknown[]) => unknown) => resolve(rows) };
 for (const name of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit"] as const) q[name].mockReturnValue(q);
 return q;
}
function row(id: string, aiFollowup: unknown = null) { return { id, title: id, startedAt: null, createdAt: now, status: "ready", aiIntel: null, aiFollowup }; }
const segments = [{ id: "s1", meetingId: "m1", speaker: "Alex", text: "We build infrastructure", startMs: 0 }, { id: "s2", meetingId: "m2", speaker: "Alex", text: "I know Ben, an inference expert.", startMs: 10 }];
const connection = { kind: "person", name: "Ben", company: null, title: null, relationship: "knows", context: "A friend who works on inference.", speakerSegmentId: "s2", evidence: [{ segmentId: "s2" }] };
function saved(source: { title: string; startedAt: string; segments: typeof segments }) { return { sourceHash: getFollowupSourceHash(source), connectionsSourceHash: getConnectionsSourceHash(source), result: { todos: [], dynamics: [], research: [], connections: [connection] } }; }
beforeEach(() => vi.clearAllMocks());
describe("authorized Intel corpus", () => {
 it("uses created time for undated followup sources and current transcript generations only", async () => {
  const q1 = query([row("m1")]), q2 = query([segments[0]]), q3 = query([]);
  mocks.select.mockReturnValueOnce(q1).mockReturnValueOnce(q2).mockReturnValueOnce(q3);
  const corpus = await loadIntelMeetings(workspace);
  expect(corpus[0].startedAt).toBe(now.toISOString());
  const sql = new PgDialect().sqlToQuery(q2.where.mock.calls[0][0]).sql;
  expect(sql).toContain("latest_replace"); expect(sql).toContain("revoked_at");
  expect(sql).not.toContain("team_memberships");
 });
 it("reuses canonical merged timing and keeps source evidence on its original meeting", async () => {
  const source = { title: "m1", startedAt: "2020-01-01T00:00:00.000Z", segments: [segments[1], segments[0]] };
  mocks.select.mockReturnValueOnce(query([{ ...row("m1", saved(source)), createdAt: new Date("2020-01-01") }, row("m2", saved({ title: "m2", startedAt: now.toISOString(), segments: [segments[1]] }))])).mockReturnValueOnce(query(segments)).mockReturnValueOnce(query([{ meetingId: "m1", sourceMeetingId: "m2" }]));
  mocks.getComposedMeetingForFollowup.mockResolvedValue({ status: "ready", followupSource: source });
  const corpus = await loadIntelMeetings(workspace);
  expect(corpus[0].followupSource).toEqual(source);
  expect(buildCatalog(corpus).people.filter(p => p.kind === "mentioned")).toHaveLength(1);
  const contact = buildCatalog(corpus).people.find(p => p.kind === "mentioned");
  expect(contact?.name).toBe("Ben"); expect(contact?.sourceMeetingId).toBe("m2");
  expect(contact?.sourceDate).toBe(now.toISOString()); expect(contact?.meetingIds).toEqual(["m2"]);
 });
 it("drops combined followups when even one source is outside personal access", async () => {
  const source = { title: "m1", startedAt: now.toISOString(), segments };
  mocks.select.mockReturnValueOnce(query([row("m1", saved(source))])).mockReturnValueOnce(query([segments[0]])).mockReturnValueOnce(query([{ meetingId: "m1", sourceMeetingId: "m2" }]));
  mocks.getComposedMeetingForFollowup.mockResolvedValue({ status: "ready", followupSource: source });
  expect(buildCatalog(await loadIntelMeetings(workspace)).people.some(p => p.kind === "mentioned")).toBe(false);
 });
 it("refuses partial coverage at the meeting bound", async () => {
  mocks.select.mockReturnValueOnce(query(Array.from({ length: 1001 }, (_,i) => row(String(i)))));
  await expect(loadIntelMeetings(workspace)).rejects.toThrow("1,000"); expect(mocks.select).toHaveBeenCalledTimes(1);
 });
});

it("loads more than 100,000 segments without losing equal-timestamp page boundaries", async () => {
 const all = Array.from({ length: 100001 }, (_, i) => ({ ...segments[0], id: String(i).padStart(8, "0"), startMs: 0 }));
 mocks.select.mockReturnValueOnce(query([row("m1")]));
 const pages = [];
 for (let i = 0; i < all.length; i += 10000) {
   const page = query(all.slice(i, i + 10000)); pages.push(page); mocks.select.mockReturnValueOnce(page);
 }
 mocks.select.mockReturnValueOnce(query([]));
 const corpus = await loadIntelMeetings(workspace);
 expect(corpus[0].segments).toHaveLength(100001);
 expect(new Set(corpus[0].segments.map(s => s.id)).size).toBe(100001);
 const next = new PgDialect().sqlToQuery(pages[1].where.mock.calls[0][0]);
 expect(next.sql).toContain('"transcript_segments"."id" >');
 expect(next.params).toContain(all[9999].id);
 expect(next.sql).toContain('"meetings"."team_id"');
 expect(next.sql).toContain("latest_replace");
});
it("bounds transcript scans to groups of 25 meetings without dropping the last group", async () => {
 const rows = Array.from({ length: 26 }, (_, i) => row(`m${i}`));
 const first = query([{ ...segments[0], meetingId: "m0" }]);
 const last = query([{ ...segments[1], meetingId: "m25" }]);
 mocks.select.mockReturnValueOnce(query(rows)).mockReturnValueOnce(first).mockReturnValueOnce(last).mockReturnValueOnce(query([]));
 const corpus = await loadIntelMeetings(workspace);
 expect(corpus.map(m => m.id)).toEqual(["m0", "m25"]);
 const firstQuery = new PgDialect().sqlToQuery(first.where.mock.calls[0][0]);
 expect(firstQuery.params).not.toContain("m25");
 const lastQuery = new PgDialect().sqlToQuery(last.where.mock.calls[0][0]);
 expect(lastQuery.params).toContain("m25");
 expect(lastQuery.params).not.toContain("m0");
});
it("loads at most six independent meeting groups concurrently", async () => {
 const rows = Array.from({ length: 200 }, (_, i) => row(`m${i}`));
 let release!: () => void;
 const gate = new Promise<void>(resolve => { release = resolve; });
 const pending = query([]);
 pending.then = async resolve => { await gate; return resolve([]); };
 mocks.select.mockReturnValueOnce(query(rows)).mockReturnValue(pending);
 const loading = loadIntelMeetings(workspace);
 await new Promise(resolve => setTimeout(resolve, 0));
 const inFlight = mocks.select.mock.calls.length - 1;
 release(); await loading;
 expect(inFlight).toBe(6);
});

it("loads only the current user's full private notes alongside authorized meetings", async () => {
 const notes = { content: "Complete notes", blocks: [{ id: "b", text: "Complete notes" }] };
 const q = query([{ ...row("m1"), notes }]);
 mocks.select.mockReturnValueOnce(q).mockReturnValueOnce(query([segments[0]])).mockReturnValueOnce(query([]));
 const corpus = await loadIntelMeetings(workspace);
 expect(corpus[0].notes).toEqual(notes);
 const join = new PgDialect().sqlToQuery(q.leftJoin.mock.calls[0][1]);
 expect(join.sql).toContain('"meeting_notes"."user_id"');
 expect(join.params).toContain(workspace.userId);
});
