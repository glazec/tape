import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";

// Opt in with a migrated, disposable localhost database. Fixtures roll back.
const url = process.env.PERSON_TEST_DATABASE_URL;
const team = randomUUID(), otherTeam = randomUUID(), owner = randomUUID(), member = randomUUID(), outsider = randomUUID(), guest = randomUUID();
let db: Client;

async function as<T>(user: string, run: () => Promise<T>) {
  await db.query("SAVEPOINT as_user");
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user })]);
    await db.query("SET LOCAL ROLE tape_authenticated");
    const result = await run();
    await db.query("RESET ROLE");
    await db.query("RELEASE SAVEPOINT as_user");
    return result;
  } catch (error) {
    await db.query("ROLLBACK TO SAVEPOINT as_user");
    await db.query("RESET ROLE");
    throw error;
  }
}
async function meetingWith(labels: Array<string | null>, timeline: Array<{ name: string; email: string }> = []) {
  const meeting = randomUUID(), job = randomUUID();
  await db.query("insert into meetings(id,team_id,owner_user_id,title,platform) values($1,$2,$3,'Call','upload')", [meeting, team, owner]);
  await db.query("insert into transcript_jobs(id,meeting_id,status) values($1,$2,'completed')", [job, meeting]);
  for (const [index, person] of timeline.entries()) {
    await db.query("insert into meeting_participant_timeline(meeting_id,recall_participant_id,name,email,start_ms) values($1,$2,$3,$4,0)", [meeting, String(index), person.name, person.email]);
  }
  const segments = [];
  for (const [index, label] of labels.entries()) {
    segments.push((await db.query("insert into transcript_segments(meeting_id,job_id,speaker,start_ms,text) values($1,$2,$3,$4,'Hello') returning id, meeting_speaker_id", [meeting, job, label, index * 1000])).rows[0]);
  }
  return { meeting, job, segments: segments as Array<{ id: string; meeting_speaker_id: string }> };
}
async function personOf(group: string) {
  return (await db.query("select person_id from meeting_speakers where id=$1", [group])).rows[0].person_id as string | null;
}
async function newPerson(name: string, emails: string[] = [], teamId = team) {
  const id = (await db.query("insert into workspace_people(team_id,preferred_name) values($1,$2) returning id", [teamId, name])).rows[0].id as string;
  for (const email of emails) await db.query("insert into person_emails(person_id,team_id,email) values($1,$2,$3)", [id, teamId, email]);
  return id;
}

describe.skipIf(!url)("person pages PostgreSQL", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local disposable database only");
    db = new Client({ connectionString: url });
    await db.connect();
    await db.query("BEGIN");
    await db.query("insert into teams(id,name) values($1,'Team'),($2,'Other')", [team, otherTeam]);
    for (const [id, email] of [[owner, "owner@team.test"], [member, "member@team.test"], [outsider, "outsider@other.test"], [guest, "guest@else.test"]]) {
      await db.query("insert into users(id,auth_user_id,email) values($1::uuid,$1::text,$2)", [id, email]);
    }
    await db.query("insert into team_memberships(team_id,user_id,role) values($1,$2,'owner'),($1,$3,'member'),($4,$5,'member'),($1,$6,'external')", [team, owner, member, otherTeam, outsider, guest]);
  });
  afterAll(async () => { if (db) { await db.query("ROLLBACK"); await db.end(); } });

  it("opens an unlinked speaker as a person without changing meeting attribution", async () => {
    const { meeting, segments } = await meetingWith(["Dana Wu", "Speaker 2"], [{ name: "Dana Wu", email: "dana@acme.test" }]);
    const personId = await as(owner, async () => (await db.query("select app_private.open_speaker_person($1,$2) id", [meeting, segments[0].meeting_speaker_id])).rows[0].id);
    expect(await personOf(segments[0].meeting_speaker_id)).toBe(personId);
    expect((await db.query("select email from person_emails where person_id=$1", [personId])).rows).toEqual([{ email: "dana@acme.test" }]);
    expect((await db.query("select attribution_revision from meetings where id=$1", [meeting])).rows[0].attribution_revision).toBe(0);
    // Opening again reuses the link; a generic label cannot become a person.
    expect(await as(owner, async () => (await db.query("select app_private.open_speaker_person($1,$2) id", [meeting, segments[0].meeting_speaker_id])).rows[0].id)).toBe(personId);
    await expect(as(owner, () => db.query("select app_private.open_speaker_person($1,$2)", [meeting, segments[1].meeting_speaker_id]))).rejects.toThrow(/name this speaker/i);
  });

  it("reuses the person with that confirmed email or unique full name instead of duplicating", async () => {
    const existing = await newPerson("Erin Park", ["erin@acme.test"]);
    const byEmail = await meetingWith(["erin@acme.test"]);
    // Auto attribution already links an email label.
    expect(await personOf(byEmail.segments[0].meeting_speaker_id)).toBe(existing);
    await db.query("update meeting_speakers set person_id=null where id=$1", [byEmail.segments[0].meeting_speaker_id]);
    const byName = await meetingWith(["Erin Park"]);
    const opened = await as(owner, async () => (await db.query("select app_private.open_speaker_person($1,$2) id", [byName.meeting, byName.segments[0].meeting_speaker_id])).rows[0].id);
    expect(opened).toBe(existing);
  });

  it("requires speaker edit rights to create people", async () => {
    const { meeting, segments } = await meetingWith(["Finn Lo"]);
    await expect(as(member, () => db.query("select app_private.open_speaker_person($1,$2)", [meeting, segments[0].meeting_speaker_id]))).rejects.toThrow(/not found/i);
    await expect(as(outsider, () => db.query("select app_private.open_participant_person($1,'finn@acme.test')", [meeting]))).rejects.toThrow(/not found/i);
  });

  it("opens a participant by email only when they took part", async () => {
    const { meeting } = await meetingWith(["Gia"], [{ name: "Gia Romano", email: "Gia@Acme.test" }]);
    const id = await as(owner, async () => (await db.query("select app_private.open_participant_person($1,'gia@acme.test','Gia Romano') id", [meeting])).rows[0].id);
    expect((await db.query("select preferred_name from workspace_people where id=$1", [id])).rows[0].preferred_name).toBe("Gia Romano");
    await expect(as(owner, () => db.query("select app_private.open_participant_person($1,'stranger@acme.test')", [meeting]))).rejects.toThrow(/participant/i);
  });

  it("merges duplicates, redirects, and attributes future meetings by every remembered name and email", async () => {
    const keep = await newPerson("Hana Sato", ["hana@acme.test"]);
    const duplicate = await newPerson("hana.s", ["hana.sato@gmail.test"]);
    const old = await meetingWith(["hana.s"]);
    await db.query("update meeting_speakers set person_id=$1 where id=$2", [duplicate, old.segments[0].meeting_speaker_id]);
    await db.query("insert into person_profiles(person_id,generated_by,team_id,profile) values($1,$2,$3,'{}')", [keep, owner, team]);

    // Only someone who can edit every affected meeting, or an admin, may merge.
    await expect(as(member, () => db.query("select app_private.merge_people($1,array[$2]::uuid[])", [keep, duplicate]))).rejects.toThrow(/admin/i);
    await expect(as(guest, () => db.query("select app_private.merge_people($1,array[$2]::uuid[])", [keep, duplicate]))).rejects.toThrow(/not found/i);
    await as(owner, () => db.query("select app_private.merge_people($1,array[$2]::uuid[],'Hana Sato')", [keep, duplicate]));
    expect((await db.query("select count(*)::int n from meeting_speaker_changes where metadata->>'action'='merge_people' and metadata->>'personId'=$1", [keep])).rows[0].n).toBe(1);

    expect(await personOf(old.segments[0].meeting_speaker_id)).toBe(keep);
    expect((await db.query("select merged_into_id from workspace_people where id=$1", [duplicate])).rows[0].merged_into_id).toBe(keep);
    expect((await db.query("select email from person_emails where person_id=$1 order by email", [keep])).rows.map(row => row.email)).toEqual(["hana.sato@gmail.test", "hana@acme.test"]);
    expect((await db.query("select attribution_revision from meetings where id=$1", [old.meeting])).rows[0].attribution_revision).toBe(0);
    expect((await db.query("select count(*)::int n from person_profiles where person_id=$1", [keep])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from person_merges where target_person_id=$1", [keep])).rows[0].n).toBe(1);

    const future = await meetingWith(["Hana.S", "hana.sato@gmail.test", "hana sato", "Speaker 1"]);
    const people = await Promise.all(future.segments.map(segment => personOf(segment.meeting_speaker_id)));
    expect(people).toEqual([keep, keep, keep, null]);
  });

  it("undoes the latest merge exactly", async () => {
    const keep = await newPerson("Lena Ortiz", ["lena@acme.test"]);
    const first = await newPerson("L. Ortiz", ["lortiz@gmail.test", "lena@acme.test"]);
    const second = await newPerson("lena");
    const meeting = await meetingWith(["L. Ortiz"]);
    await db.query("update meeting_speakers set person_id=$1 where id=$2", [first, meeting.segments[0].meeting_speaker_id]);
    await as(owner, () => db.query("select app_private.merge_people($1,array[$2,$3]::uuid[],'L. Ortiz')", [keep, first, second]));
    const restored = await as(owner, async () => (await db.query("select app_private.unmerge_people($1) r", [keep])).rows[0].r);
    expect([...restored.restored].sort()).toEqual([first, second].sort());
    expect(await personOf(meeting.segments[0].meeting_speaker_id)).toBe(first);
    expect((await db.query("select preferred_name from workspace_people where id=$1", [keep])).rows[0].preferred_name).toBe("Lena Ortiz");
    expect((await db.query("select email from person_emails where person_id=$1 order by email", [keep])).rows.map(row => row.email)).toEqual(["lena@acme.test"]);
    expect((await db.query("select email from person_emails where person_id=$1 order by email", [first])).rows.map(row => row.email)).toEqual(["lena@acme.test", "lortiz@gmail.test"]);
    expect((await db.query("select count(*)::int n from person_names where person_id=$1", [keep])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from workspace_people where id in ($1,$2) and merged_into_id is not null", [first, second])).rows[0].n).toBe(0);
    await expect(as(owner, () => db.query("select app_private.unmerge_people($1)", [keep]))).rejects.toThrow(/nothing to undo/i);
  });

  it("never attributes an ambiguous name, a lone first name, or across workspaces", async () => {
    const a = await newPerson("Ivy Chen"), b = await newPerson("Ivy Chen 2"), foreign = await newPerson("Jo Bell", [], otherTeam);
    await db.query("select app_private.remember_person_name($1,$2,'Ivy Chen'),app_private.remember_person_name($3,$2,'Ivy Chen'),app_private.remember_person_name($1,$2,'Ivy')", [a, team, b]);
    await db.query("select app_private.remember_person_name($1,$2,'Jo Bell')", [foreign, otherTeam]);
    expect((await db.query("select count(*)::int n from person_names where name_key='ivy'")).rows[0].n).toBe(0);
    const meeting = await meetingWith(["Ivy Chen", "Jo Bell", "Ivy"]);
    expect(await personOf(meeting.segments[0].meeting_speaker_id)).toBeNull();
    expect(await personOf(meeting.segments[1].meeting_speaker_id)).toBeNull();
    expect(await personOf(meeting.segments[2].meeting_speaker_id)).toBeNull();
    await expect(as(owner, () => db.query("select app_private.merge_people($1,array[$2]::uuid[])", [a, foreign]))).rejects.toThrow(/workspace/i);
    await expect(as(outsider, () => db.query("select app_private.merge_people($1,array[$2]::uuid[])", [a, b]))).rejects.toThrow(/not found/i);
  });

  it("shows colleagues every team meeting with the person, without opening transcripts", async () => {
    const person = await newPerson("Noor Haddad", ["noor@acme.test"]);
    const spoke = await meetingWith(["Noor Haddad", "Owner"]);
    await db.query("update meeting_speakers set person_id=$1 where id=$2", [person, spoke.segments[0].meeting_speaker_id]);
    const invited = await meetingWith([]);
    await db.query("insert into meeting_attendees(meeting_id,email) values($1,'noor@acme.test'),($1,'member@team.test')", [invited.meeting]);
    const list = await as(member, async () => (await db.query("select * from app_private.person_team_meetings($1)", [person])).rows);
    expect(list.map(row => [row.id, row.canOpen, Number(row.talkMs ?? 0) > 0]).sort()).toEqual([[spoke.meeting, false, true], [invited.meeting, false, false]].sort());
    expect(list.find(row => row.id === invited.meeting).colleagues.sort()).toEqual(["member@team.test", "owner@team.test"]);
    const own = await as(member, async () => (await db.query("select * from app_private.person_team_segments($1,$2::uuid[],true)", [person, [spoke.meeting]])).rows);
    expect(own).toHaveLength(1);
    expect(own[0].subject).toBe(true);
    await expect(as(guest, () => db.query("select * from app_private.person_team_meetings($1)", [person]))).rejects.toThrow(/not found/i);
    await expect(as(outsider, () => db.query("select * from app_private.person_team_segments($1,$2::uuid[],false)", [person, [spoke.meeting]]))).rejects.toThrow(/not found/i);
    expect(await as(member, async () => (await db.query("select app_private.is_person_colleague($1) c", [person])).rows[0].c)).toBe(false);
  });

  it("shares a person's profile and to do progress with colleagues only", async () => {
    const person = await newPerson("Kai Moss");
    await as(owner, () => db.query("insert into person_profiles(person_id,generated_by,team_id,profile) values($1,$2,$3,'{\"summary\":\"team view\"}')", [person, owner, team]));
    expect(await as(member, async () => (await db.query("select * from person_profiles where person_id=$1", [person])).rows)).toHaveLength(1);
    expect(await as(guest, async () => (await db.query("select * from person_profiles where person_id=$1", [person])).rows)).toHaveLength(0);
    await expect(as(member, () => db.query("insert into person_profiles(person_id,generated_by,team_id,profile) values($1,$2,$3,'{}') on conflict (person_id) do update set generated_by=excluded.generated_by", [person, owner, team]))).rejects.toThrow(/row-level security/i);
    expect(await as(outsider, async () => (await db.query("select * from workspace_people where id=$1", [person])).rows)).toHaveLength(0);
    expect(await as(guest, async () => (await db.query("select app_private.is_internal_member($1) ok", [team])).rows[0].ok)).toBe(false);
    await expect(as(member, () => db.query("insert into person_names(person_id,team_id,name_key,name) values($1,$2,'x','x')", [person, team]))).rejects.toThrow(/permission denied/i);

    // A colleague who cannot open the meeting still moves its to do along.
    const { meeting } = await meetingWith(["Kai Moss"]);
    const key = "a".repeat(32);
    const progress = await as(member, async () => (await db.query("select app_private.set_todo_status($1,$2,'in_progress') s", [meeting, key])).rows[0].s);
    expect(progress).toMatchObject({ status: "in_progress", updatedBy: "member@team.test" });
    const done = await as(owner, async () => (await db.query("select app_private.set_todo_status($1,$2,'done') s", [meeting, key])).rows[0].s);
    expect(done).toMatchObject({ status: "done", updatedBy: "owner@team.test" });
    expect(await as(member, async () => (await db.query("select status from followup_todo_states where meeting_id=$1", [meeting])).rows)).toEqual([{ status: "done" }]);
    await expect(as(guest, () => db.query("select app_private.set_todo_status($1,$2,'todo')", [meeting, key]))).rejects.toThrow(/not found/i);
    await expect(as(outsider, () => db.query("select app_private.set_todo_status($1,$2,'todo')", [meeting, key]))).rejects.toThrow(/not found/i);
    await expect(as(member, () => db.query("select app_private.set_todo_status($1,$2,'archived')", [meeting, key]))).rejects.toThrow(/valid status/i);
    await expect(as(member, () => db.query("update followup_todo_states set status='todo'"))).rejects.toThrow(/permission denied/i);
  });
});
