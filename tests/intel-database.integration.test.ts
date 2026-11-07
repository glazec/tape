import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ client: null as import("pg").Client | null }));
const enabled = Boolean(process.env.INTEL_TEST_DATABASE_URL);
vi.mock("@/db/client", async () => {
  const url = process.env.INTEL_TEST_DATABASE_URL;
  if (!url) return { db: {} };
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("This test only runs against an isolated local database");
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("@/db/schema");
  state.client = new Client({ connectionString: url });
  await state.client.connect();
  return { db: drizzle(state.client, { schema }) };
});
import { loadIntelMeetings, loadIntelHistory } from "@/lib/intel/store";
vi.mock("@/inngest/client", () => ({ inngest: { send: vi.fn() } }));
import { enqueueIntelSearch, executeIntelSearch, previewIntelSearch, readIntelJob } from "@/lib/intel/jobs";
import { searchIntel } from "@/lib/intel/search";
import { buildCatalog, intelSourceHash, currentIntel } from "@/lib/intel/provenance";
const team = "11111111-1111-4111-8111-111111111111";
const a = "22222222-2222-4222-8222-222222222222";
const b = "33333333-3333-4333-8333-333333333333";
const m = "44444444-4444-4444-8444-444444444444";
const privateMeeting = "55555555-5555-4555-8555-555555555555";
const oldJob = "66666666-6666-4666-8666-666666666666";
const currentJob = "77777777-7777-4777-8777-777777777777";
const segment = "88888888-8888-4888-8888-888888888888";
const workspace = { teamId: team, userId: a, domain: "example.test" };
async function asUser(id: string) {
  await state.client!.query("SET LOCAL ROLE tape_authenticated");
  await state.client!.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: id, email: `${id}@example.test` })]);
}
describe.skipIf(!enabled)("Intel with real PostgreSQL and caller RLS", () => {
  beforeAll(async () => {
    const client = state.client!;
    await client.query("BEGIN");
    await client.query("INSERT INTO teams(id,name) VALUES($1,'Intel integration')", [team]);
    for (const id of [a,b]) {
      await client.query("INSERT INTO users(id,auth_user_id,email) VALUES($1,$3,$2)", [id,`${id}@example.test`,id]);
      await client.query("INSERT INTO team_memberships(team_id,user_id) VALUES($1,$2)", [team,id]);
    }
    for (const [id,owner] of [[m,a],[privateMeeting,b]]) await client.query("INSERT INTO meetings(id,team_id,owner_user_id,title,platform,status) VALUES($1,$2,$3,'Intel source','google_meet','ready')", [id,team,owner]);
    await client.query("INSERT INTO transcript_jobs(id,meeting_id,status,created_at) VALUES($1,$3,'completed',now()-interval '1 day'),($2,$3,'completed',now())", [oldJob,currentJob,m]);
    await client.query("INSERT INTO transcript_segments(meeting_id,job_id,speaker,start_ms,text) VALUES($1,$2,'Alex',0,'Obsolete content')", [m,oldJob]);
    await client.query("INSERT INTO transcript_segments(id,meeting_id,job_id,speaker,start_ms,text) VALUES($1,$2,$3,'Alex',1000,'We need inference partners')", [segment,m,currentJob]);
    await client.query("INSERT INTO meeting_notes(meeting_id,user_id,content) VALUES($1,$2,'Caller full notes'),($1,$3,'Another user private notes')", [m,a,b]);
    await asUser(a);
  });
  afterAll(async () => { if (state.client) { await state.client.query("ROLLBACK"); await state.client.end(); } });
  it("reads personally accessible current transcripts through the actual SQL", async () => {
    const corpus = await loadIntelMeetings(workspace);
    expect(corpus.map(m => m.id)).toEqual([m]);
    expect(corpus[0].segments.map(s => s.text)).toEqual(["We need inference partners"]);
    expect(corpus[0].notes?.content).toBe("Caller full notes");
    expect(JSON.stringify(corpus)).not.toContain("Another user private notes");
  });
  it("roundtrips generated intel through JSONB without changing its identity", async () => {
    const [meeting] = await loadIntelMeetings(workspace);
    const stored = { sourceHash: intelSourceHash(meeting), result: { items: [{ kind: "plan", text: "Alex needs inference partners", importance: "normal", speakerSegmentId: segment, segmentIds: [segment] }] } };
    await state.client!.query("UPDATE meetings SET ai_intel=$1::jsonb WHERE id=$2", [JSON.stringify(stored),m]);
    const [readback] = await loadIntelMeetings(workspace);
    expect(currentIntel(readback)?.items).toHaveLength(1);
    expect(buildCatalog([readback]).intel[0].text).toBe("Alex needs inference partners");
  });
  it("persists private history and blocks another member at the database boundary", async () => {
    await enqueueIntelSearch(workspace, { kind: "content", text: "Inference partners" });
    expect(await loadIntelHistory(workspace, await loadIntelMeetings(workspace))).toHaveLength(1);
    await asUser(b);
    expect((await state.client!.query("SELECT * FROM intel_searches")).rows).toHaveLength(0);
    await asUser(a);
  });
  it.skipIf(!process.env.INTEL_LIVE_MODEL_CHECK)("matches through the live model and verifier against the real authorized corpus", async () => {
    const corpus = await loadIntelMeetings(workspace);
    const result = await searchIntel(workspace, { kind: "content", text: "An inference infrastructure provider is looking for partners. Who has expressed a need for inference partners?" }, corpus);
    expect(result.matches.some(match => match.title === "Alex" && match.evidence.some(e => e.id === segment))).toBe(true);
    expect(result.catalog.people).toHaveLength(1);
  }, 180000);
  it("limits history to fifty entries using the real pruning query", async () => {
    await state.client!.query("INSERT INTO intel_searches(team_id,user_id,input,created_at) SELECT $1,$2,jsonb_build_object('kind','content','text','Older idea ' || n),now()-interval '1 day' FROM generate_series(1,51) n", [team,a]);
    const {id: newest} = await enqueueIntelSearch(workspace, { kind: "person", ids: ["missing"] });
    await executeIntelSearch(workspace, newest);
    expect((await state.client!.query("SELECT id FROM intel_searches WHERE id=$1", [newest])).rows).toHaveLength(1);
    expect((await state.client!.query("SELECT count(*)::int AS count FROM intel_searches WHERE status IS DISTINCT FROM 'queued'")).rows[0].count).toBe(50);
  });
  it("quotes the selected evidence without starting a search and preserves the estimate through failure", async () => {
    const input = { kind: "content" as const, text: "Inference partners" };
    const { id, estimate } = await previewIntelSearch(workspace, input);
    expect(estimate.highUsd).toBeGreaterThan(estimate.lowUsd);
    expect(estimate.lowUsd).toBeGreaterThan(0);
    expect(await readIntelJob(workspace, id)).toBeNull();
    expect((await loadIntelHistory(workspace, await loadIntelMeetings(workspace))).some(h => h.id === id)).toBe(false);
    await expect(enqueueIntelSearch(workspace, { ...input, text: "another search" }, id)).rejects.toThrow();
    await asUser(b);
    await expect(enqueueIntelSearch({ ...workspace, userId: b }, input, id)).rejects.toThrow();
    await asUser(a);
    await enqueueIntelSearch(workspace, input, id);
    await expect(enqueueIntelSearch(workspace, input, id)).rejects.toThrow();
    expect(await readIntelJob(workspace, id)).toMatchObject({ status: "queued", estimate });
    await state.client!.query("UPDATE intel_searches SET status='failed' WHERE id=$1", [id]);
    expect(await readIntelJob(workspace, id)).toMatchObject({ status: "failed", estimate });
  });
  it("runs a queued job without a browser, resumes the saved result, and blocks changed evidence", async () => {
    const w = { ...workspace, userId: b };
    await asUser(b);
    const { id } = await enqueueIntelSearch(w, { kind: "content", text: "Find an inference partner" });
    expect((await readIntelJob(w))?.status).toBe("queued");
    await executeIntelSearch(w, id);
    expect(await readIntelJob(w)).toMatchObject({ id, status: "complete", result: { matches: [] } });
    await asUser(a);
    expect(await readIntelJob(workspace, id)).toBeNull();
    await state.client!.query("RESET ROLE");
    await state.client!.query("UPDATE meetings SET owner_user_id=$1 WHERE id=$2", [b,m]);
    await asUser(b);
    const changed = await readIntelJob(w, id);
    expect(changed?.status).toBe("failed");
    expect(changed).not.toHaveProperty("result");
    await state.client!.query("RESET ROLE");
    await state.client!.query("UPDATE meetings SET owner_user_id=$1 WHERE id=$2", [a,m]);
    await asUser(a);
  });
  it("saves scored results without an acceptance step and withholds a real match after access is revoked", async () => {
    const router = await import("@/lib/vendors/openrouter");
    const verifier = await import("@/lib/intel/verification");
    const [meeting] = await loadIntelMeetings(workspace);
    const target = buildCatalog([meeting]).people[0];
    const match = { id: target.id, type: "person", score: 35, relevance: "expressed_interest", reason: "Alex needs inference partners.", caveat: "", segmentIds: [segment], counterEvidenceIds: [] };
    const model = vi.spyOn(router, "createOpenRouterChatCompletion").mockResolvedValue(JSON.stringify({ matches: [match] }));
    const verify = vi.spyOn(verifier, "verifyIntelClaims");
    const { id } = await enqueueIntelSearch(workspace, { kind: "content", text: "Inference partners" });
    try {
      await executeIntelSearch(workspace, id);
      expect(verify).not.toHaveBeenCalled();
      expect(await readIntelJob(workspace, id)).toMatchObject({ status: "complete", completed: 1, total: 1, result: { matches: [{ title: "Alex", score: 35 }] } });
      await state.client!.query("SAVEPOINT revoke_intel_access");
      try {
        await state.client!.query("RESET ROLE");
        await state.client!.query("UPDATE meetings SET owner_user_id=$1 WHERE id=$2", [b,m]);
        await asUser(a);
        const revoked = await readIntelJob(workspace, id);
        expect(revoked?.status).toBe("failed");
        expect(revoked).not.toHaveProperty("result");
      } finally { await state.client!.query("ROLLBACK TO SAVEPOINT revoke_intel_access"); }
    } finally { verify.mockRestore(); model.mockRestore(); }
  });
  it("pages a large transcript through real SQL without dropping equal timestamps", async () => {
    const client = state.client!;
    await client.query("SAVEPOINT large_intel_archive");
    try {
      await client.query("RESET ROLE");
      await client.query("INSERT INTO transcript_segments(meeting_id,job_id,speaker,start_ms,text) SELECT $1,$2,'Alex',1000,'Page boundary evidence ' || n FROM generate_series(1,10005) n", [m,currentJob]);
      await asUser(a);
      const corpus = await loadIntelMeetings(workspace);
      expect(corpus.map(m => m.id)).toEqual([m]);
      expect(corpus[0].segments).toHaveLength(10006);
      expect(new Set(corpus[0].segments.map(s => s.id)).size).toBe(10006);
      expect(corpus[0].segments.some(s => s.text === "Obsolete content")).toBe(false);
    } finally { await client.query("ROLLBACK TO SAVEPOINT large_intel_archive"); }
  });

});
