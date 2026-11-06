import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
const url = process.env.SPEAKER_TEST_DATABASE_URL;
const team = randomUUID(), user = randomUUID(), meeting = randomUUID(), job = randomUUID();
let db: Client;
async function mutate(segmentId: string, extra: Record<string, unknown> = {}) {
  return (await db.query("select app_private.mutate_speaker($1,$2::jsonb) result", [meeting, JSON.stringify({ segmentId, speaker: "Alice", applyTo: "matching_speaker", linkAction: "preserve", ...extra })])).rows[0].result;
}
describe.skipIf(!url)("speaker identity PostgreSQL", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local disposable database only");
    db = new Client({ connectionString: url }); await db.connect();
    await db.query("BEGIN");
    await db.query("insert into teams(id,name) values($1,'Test')", [team]);
    await db.query("insert into users(id,auth_user_id,email) values($1::uuid,$1::text,'speaker@example.test')", [user]);
    await db.query("insert into team_memberships(team_id,user_id) values($1,$2)", [team,user]);
    await db.query("insert into meetings(id,team_id,owner_user_id,title,platform) values($1,$2,$3,'Test','upload')", [meeting,team,user]);
    await db.query("insert into transcript_jobs(id,meeting_id,status) values($1,$2,'completed')", [job,meeting]);
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({sub:user})]);
  });
  afterAll(async () => { if(db) { await db.query("ROLLBACK"); await db.end(); } });
  it("groups exact source labels and preserves raw text across name edits and ingestion retries", async () => {
    const rows = (await db.query("insert into transcript_segments(meeting_id,job_id,speaker,start_ms,text) values($1,$2,'Speaker 1',0,'One'),($1,$2,'Speaker 1',1,'Two') returning *", [meeting,job])).rows;
    expect(rows[0].meeting_speaker_id).toBeTruthy(); expect(rows[1].meeting_speaker_id).toBe(rows[0].meeting_speaker_id);
    await mutate(rows[0].id, { expectedRevision: 0 });
    const next = (await db.query("insert into transcript_segments(meeting_id,job_id,speaker,start_ms,text) values($1,$2,'Speaker 1',2,'Three') returning *", [meeting,job])).rows[0];
    expect(next.meeting_speaker_id).toBe(rows[0].meeting_speaker_id);
    expect((await db.query("select display_name from meeting_speakers where id=$1", [next.meeting_speaker_id])).rows[0].display_name).toBe("Alice");
    expect((await db.query("select speaker from transcript_segments where id=$1", [rows[0].id])).rows[0].speaker).toBe("Speaker 1");
  });
  it("splits one line, preserves previous membership audit and rejects stale edits", async () => {
    const rows = (await db.query("select * from transcript_segments where meeting_id=$1 order by start_ms", [meeting])).rows;
    const result = await mutate(rows[0].id, { applyTo: "segment", linkAction: "create", expectedRevision: 1 });
    expect(result.segments.find((s: {id:string})=>s.id===rows[0].id).personId).toBeTruthy();
    expect((await db.query("select meeting_speaker_id from transcript_segments where id=$1", [rows[1].id])).rows[0].meeting_speaker_id).toBe(rows[1].meeting_speaker_id);
    expect((await db.query("select metadata from meeting_speaker_changes where metadata->>'personId' is not null limit 1")).rows[0].metadata.previousMeetingSpeakerId).toBe(rows[0].meeting_speaker_id);
    await db.query("SAVEPOINT stale");
    await expect(mutate(rows[1].id, {expectedRevision:0})).rejects.toThrow(/refresh/i);
    await db.query("ROLLBACK TO SAVEPOINT stale");
  });
  it("runs the atomic mutation under the actual authenticated role and preserves name-only revision", async () => {
    const row=(await db.query("select * from transcript_segments where meeting_id=$1 order by start_ms limit 1", [meeting])).rows[0];
    const before=(await db.query("select attribution_revision from meetings where id=$1", [meeting])).rows[0].attribution_revision;
    const revision=(await db.query("select revision from meeting_speakers where id=$1", [row.meeting_speaker_id])).rows[0].revision;
    await db.query("SET LOCAL ROLE tape_authenticated");
    const result=await mutate(row.id,{speaker:"Alex",preferredName:"Alex",expectedRevision:revision});
    expect(result.person.name).toBe("Alex");
    expect((await db.query("select attribution_revision from meetings where id=$1",[meeting])).rows[0].attribution_revision).toBe(before);
    await db.query("RESET ROLE");
  });
  it("allows explicit people sharing a mailbox without merging and rejects unconfirmed participant email", async () => {
    await db.query("insert into meeting_attendees(meeting_id,email) values($1,'shared@example.test')",[meeting]);
    const rows=(await db.query("insert into transcript_segments(meeting_id,job_id,speaker,start_ms,text) values($1,$2,'A',10,'A'),($1,$2,'B',20,'B') returning *",[meeting,job])).rows;
    const people=[];
    for(const row of rows) people.push((await mutate(row.id,{linkAction:"create",speaker:"Alex",participantEmail:"shared@example.test",expectedRevision:0})).person.id);
    expect(people[0]).not.toBe(people[1]);
    expect((await db.query("select * from person_emails where email='shared@example.test'")).rows).toHaveLength(2);
    await db.query("SAVEPOINT invalid_email");
    await expect(mutate(rows[0].id,{linkAction:"link",personId:people[0],participantEmail:"outsider@example.test",expectedRevision:1})).rejects.toThrow(/participant email/i);
    await db.query("ROLLBACK TO SAVEPOINT invalid_email");
  });
  it("keeps same display names separate and rejects ambiguous legacy labels", async () => {
    const rows=(await db.query("insert into transcript_segments(meeting_id,job_id,speaker,start_ms,text) values($1,$2,'Same source',30,'A'),($1,$2,'Same source',40,'B') returning *",[meeting,job])).rows;
    await mutate(rows[0].id,{applyTo:"segment",speaker:"Alex",expectedRevision:0});
    await db.query("SAVEPOINT ambiguous");
    await expect(db.query("select app_private.mutate_speaker($1,$2::jsonb)",[meeting,JSON.stringify({currentSpeaker:"Same source",speaker:"Alex"})])).rejects.toThrow(/refresh/i);
    await db.query("ROLLBACK TO SAVEPOINT ambiguous");
    const groups=(await db.query("select distinct meeting_speaker_id from transcript_segments where speaker='Same source' and meeting_id=$1",[meeting])).rows;
    expect(groups).toHaveLength(2);
  });
  it("rejects a person from another workspace and mismatched segment membership at the database boundary", async () => {
    const otherTeam=randomUUID(),otherPerson=randomUUID();
    await db.query("insert into teams(id,name) values($1,'Other')",[otherTeam]);
    await db.query("insert into workspace_people(id,team_id,preferred_name) values($1,$2,'Foreign')",[otherPerson,otherTeam]);
    const row=(await db.query("select s.id,g.revision from transcript_segments s join meeting_speakers g on g.id=s.meeting_speaker_id where s.meeting_id=$1 limit 1",[meeting])).rows[0];
    await db.query("SAVEPOINT foreign_person");
    await expect(mutate(row.id,{linkAction:"link",personId:otherPerson,expectedRevision:row.revision})).rejects.toThrow(/workspace/);
    await db.query("ROLLBACK TO SAVEPOINT foreign_person");
    const otherJob=randomUUID();
    await db.query("insert into transcript_jobs(id,meeting_id,status,mode) values($1,$2,'completed','append')",[otherJob,meeting]);
    const group=(await db.query("select meeting_speaker_id from transcript_segments where id=$1",[row.id])).rows[0].meeting_speaker_id;
    await db.query("SAVEPOINT foreign_job");
    await expect(db.query("insert into transcript_segments(meeting_id,job_id,meeting_speaker_id,start_ms,text) values($1,$2,$3,0,'Bad')",[meeting,otherJob,group])).rejects.toThrow(/another speaker job/);
    await db.query("ROLLBACK TO SAVEPOINT foreign_job");
  });
  it("shared readers see display labels but cannot browse contacts, emails, private notes or mutate", async () => {
    const viewer=randomUUID();
    await db.query("insert into users(id,auth_user_id,email) values($1::uuid,$1::text,'viewer@example.test')",[viewer]);
    await db.query("insert into meeting_access(meeting_id,user_id,role) values($1,$2,'shared')",[meeting,viewer]);
    await db.query("insert into meeting_notes(meeting_id,user_id,content) values($1,$2,'Private note')",[meeting,user]);
    await db.query("SET LOCAL ROLE tape_authenticated");
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:viewer,app_context_trusted:true,app_team_id:team})]);
    expect((await db.query("select * from workspace_people")).rows).toHaveLength(0);
    expect((await db.query("select * from person_emails")).rows).toHaveLength(0);
    expect((await db.query("select * from meeting_notes")).rows).toHaveLength(0);
    const display=(await db.query("select * from app_private.speaker_display($1,true)",[meeting])).rows;
    expect(display.some(r=>r.speaker==="Alex")).toBe(true);
    expect(display.every(r=>r.participantEmail===null)).toBe(true);
    await db.query("SAVEPOINT forbidden");
    await expect(mutate(display[0].id,{expectedRevision:display[0].speakerRevision})).rejects.toThrow(/not found/);
    await db.query("ROLLBACK TO SAVEPOINT forbidden");
    await db.query("SAVEPOINT directory");
    await expect(db.query("select app_private.speaker_people($1)",[meeting])).rejects.toThrow(/not found/);
    await db.query("ROLLBACK TO SAVEPOINT directory");
    await db.query("RESET ROLE");
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user})]);
  });
  it("new generations receive new groups and obsolete jobs cannot be edited", async () => {
    const old=(await db.query("select s.id,g.revision from transcript_segments s join meeting_speakers g on g.id=s.meeting_speaker_id where s.meeting_id=$1 limit 1",[meeting])).rows[0];
    const replace=randomUUID(), append=randomUUID(),generation=randomUUID();
    await db.query("insert into transcript_jobs(id,meeting_id,status,generation_id,created_at) values($1,$2,'completed',$3,now()+interval '1 minute')",[replace,meeting,generation]);
    await db.query("insert into transcript_jobs(id,meeting_id,status,mode,generation_id,created_at) values($1,$2,'completed','append',$3,now()+interval '2 minutes')",[append,meeting,generation]);
    const groups=[];
    for(const j of [replace,append]) groups.push((await db.query("insert into transcript_segments(meeting_id,job_id,speaker,start_ms,text) values($1,$2,'Alex',0,'New') returning meeting_speaker_id",[meeting,j])).rows[0].meeting_speaker_id);
    expect(groups[0]).not.toBe(groups[1]);
    await db.query("SAVEPOINT obsolete");
    await expect(mutate(old.id,{expectedRevision:old.revision})).rejects.toThrow(/refresh/i);
    await db.query("ROLLBACK TO SAVEPOINT obsolete");
  });

  it("scalar speaker names expose only readable meeting names to shared and MCP callers", async () => {
    const viewer=randomUUID();
    const group=(await db.query("select g.id from meeting_speakers g where g.meeting_id=$1 and g.person_id is not null limit 1",[meeting])).rows[0].id;
    const expected=(await db.query("select p.preferred_name from meeting_speakers g join workspace_people p on p.id=g.person_id where g.id=$1",[group])).rows[0].preferred_name;
    await db.query("insert into users(id,auth_user_id,email) values($1::uuid,$1::text,'scalar-viewer@example.test')",[viewer]);
    await db.query("SET LOCAL ROLE tape_authenticated");
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:viewer,app_context_trusted:true,app_team_id:team})]);
    expect((await db.query("select app_private.speaker_name($1) name",[group])).rows[0].name).toBeNull();
    await db.query("RESET ROLE");
    await db.query("insert into meeting_access(meeting_id,user_id,role) values($1,$2,'shared')",[meeting,viewer]);
    for(const role of ["tape_authenticated","tape_mcp"]) {
      await db.query(`SET LOCAL ROLE ${role}`);
      expect((await db.query("select app_private.speaker_name($1) name",[group])).rows[0].name).toBe(expected);
      expect((await db.query("select app_private.speaker_name($1) name",[randomUUID()])).rows[0].name).toBeNull();
      expect((await db.query("select * from person_emails")).rows).toHaveLength(0);
      await db.query("RESET ROLE");
    }
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user})]);
  });

});
