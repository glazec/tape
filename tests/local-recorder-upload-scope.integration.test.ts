import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ client: null as import("pg").Client | null }));
const enabled = Boolean(process.env.INTEL_TEST_DATABASE_URL);
vi.mock("@/db/client", async () => {
  const url = process.env.INTEL_TEST_DATABASE_URL;
  if (!url) return { db: {}, databaseSql: {} };
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Use an isolated local database");
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  state.client = new Client({ connectionString: url });
  await state.client.connect();
  return { db: drizzle(state.client), databaseSql: {} };
});
import { authorizeLocalRecorderMultipartUpload } from "@/lib/local-recorder-records";
const team = randomUUID(), otherTeam = randomUUID(), user = randomUUID(), meeting = randomUUID();
const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
const input = { clientRecordingId: "scope-test", deviceId: "scope-device", fallbackIntentId: randomUUID(), recordingStartedAt: new Date(), workspace: { teamId: team, userId: user, domain: "example.test" } };
describe.skipIf(!enabled)("Recorder upload workspace boundary", () => {
  beforeAll(async () => {
    const client = state.client!;
    await client.query("BEGIN");
    await client.query("INSERT INTO teams(id,name) VALUES($1,'Capture workspace'),($2,'Other workspace')", [team,otherTeam]);
    await client.query("INSERT INTO users(id,auth_user_id,email) VALUES($1,$3,$2)", [user,`${user}@example.test`,user]);
    await client.query("INSERT INTO team_memberships(team_id,user_id) VALUES($1,$3),($2,$3)", [team,otherTeam,user]);
    await client.query("INSERT INTO meetings(id,team_id,owner_user_id,title,platform,status) VALUES($1,$2,$3,'Synthetic capture','google_meet','recording')", [meeting,team,user]);
    await client.query("INSERT INTO local_recording_attempts(meeting_id,user_id,device_id_hash,fallback_intent_id_hash,attempt_state,expires_at) VALUES($1,$2,$3,$4,'started',now()+interval '1 hour')", [meeting,user,hash(input.deviceId),hash(input.fallbackIntentId)]);
  });
  afterAll(async () => { if (state.client) { await state.client.query("ROLLBACK"); await state.client.end(); } });
  it("rejects a valid owner and device paired to a different workspace", async () => {
    await expect(authorizeLocalRecorderMultipartUpload({ ...input, workspace: { ...input.workspace, teamId: otherTeam } })).rejects.toThrow("No matching local recording intent");
    expect((await state.client!.query("SELECT attempt_state FROM local_recording_attempts WHERE meeting_id=$1", [meeting])).rows[0].attempt_state).toBe("started");
  });
  it("allows recovery in the original paired workspace", async () => {
    expect((await authorizeLocalRecorderMultipartUpload(input)).meetingId).toBe(meeting);
    expect((await state.client!.query("SELECT attempt_state FROM local_recording_attempts WHERE meeting_id=$1", [meeting])).rows[0].attempt_state).toBe("sealed");
  });
});
