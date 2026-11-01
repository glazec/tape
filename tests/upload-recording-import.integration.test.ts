import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";

const { databaseSql, reconcile, db } = vi.hoisted(() => ({
  databaseSql: Object.assign(vi.fn(), { transaction: vi.fn() }), reconcile: vi.fn(), db: { select: vi.fn() },
}));
vi.mock("@/db/client", () => ({ databaseSql, db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/meeting-share-rules", () => ({ reconcileMeetingSharingForMeeting: reconcile }));
vi.mock("@/lib/r2", () => ({ parseR2Env: () => ({ R2_BUCKET: "test" }) }));
import { importUploadedRecording } from "@/lib/upload-recording-import";
import { listUploadMeetingCandidates } from "@/lib/upload-meeting-candidates";
import { claimLocalRecorderIntent } from "@/lib/local-recorder-records";
import { setLocalRecorderRecordingTarget } from "@/lib/local-recorder-targets";

const dsn = process.env.TAPE_RECORDER_TEST_DATABASE;
const schema = `import_test_${process.pid}`;
const restrictedRole = `import_role_${process.pid}`;
let useRestrictedRole = false;
const teamId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const meetingId = "00000000-0000-4000-8000-000000000003";
const otherId = "00000000-0000-4000-8000-000000000004";
const eventId = "00000000-0000-4000-8000-000000000005";
const workspace = { teamId, userId, domain: "example.com", canCreateMeetings: true };
const startedAt = new Date("2026-10-19T15:41:00Z");
const base = { workspace, meetingId, startedAt, durationMs: 5127900, kind: "audio" as const, objectKey: "users/owner/uploads/audio.mp3" };
type Query = { text: string; values: unknown[] };
function tagged(strings: TemplateStringsArray, ...values: unknown[]): Query {
  return { text: strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), values };
}
async function connect() {
  const client = new Client({ connectionString: dsn });
  await client.connect();
  await client.query(`set search_path to ${schema}`);
  return client;
}
async function query(text: string, values: unknown[] = []) {
  const client = await connect();
  try { return (await client.query(text, values)).rows; } finally { await client.end(); }
}

describe.skipIf(!dsn)("recording imports in isolated PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(dsn!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/tape_workflow_test") throw new Error("Use the isolated local tape_workflow_test database");
    await query(`create schema ${schema}; set search_path to ${schema};
      create type asset_type as enum ('audio', 'transcript_source');
      create table team_memberships (team_id uuid, user_id uuid, role text);
      create table calendar_events (id uuid primary key, team_id uuid, starts_at timestamptz, ends_at timestamptz);
      create table meetings (id uuid primary key default gen_random_uuid(), team_id uuid, owner_user_id uuid, title text, title_source text default 'calendar', platform text, status text, calendar_event_id uuid, started_at timestamptz, ended_at timestamptz, recall_bot_id text, recall_recording_id text, bot_state text, updated_at timestamptz, created_at timestamptz default now(), organization_access_enabled boolean default false);
      create table meeting_access (meeting_id uuid, user_id uuid, source text, revoked_at timestamptz);
      create table recordings (id uuid primary key, meeting_id uuid references meetings(id), source text, started_at timestamptz, ended_at timestamptz, duration_ms int);
      create table media_assets (id uuid primary key, meeting_id uuid references meetings(id), recording_id uuid references recordings(id), source text, type asset_type, bucket text, object_key text, mime_type text, file_size_bytes bigint);
      create unique index media_assets_bucket_object_unique on media_assets(bucket, object_key);
      create table transcript_jobs (id uuid primary key, meeting_id uuid references meetings(id), recording_id uuid references recordings(id), media_asset_id uuid references media_assets(id), provider text, status text);
      create table transcript_segments (id uuid default gen_random_uuid(), meeting_id uuid references meetings(id));
      create table local_recording_attempts (id uuid default gen_random_uuid(), meeting_id uuid references meetings(id), user_id uuid, device_id_hash text, fallback_intent_id_hash text unique, attempt_state text, expires_at timestamptz, updated_at timestamptz, claimed_at timestamptz, notification_state text);
      create table local_recordings (meeting_id uuid references meetings(id), local_recording_attempt_id uuid);
    `);
    databaseSql.transaction.mockImplementation(async (build) => {
      const tx = Object.assign(tagged, { query: (text: string, values: unknown[]) => ({ text, values }) });
      const queries: Query[] = build(tx);
      const client = await connect();
      try {
        await client.query("begin");
        if (useRestrictedRole) await client.query(`set local role ${restrictedRole}`);
        const results = [];
        for (const statement of queries) results.push((await client.query(statement.text, statement.values)).rows);
        await client.query("commit");
        return results;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally { await client.end(); }
    });
  });
  beforeEach(async () => {
    reconcile.mockClear();
    db.select.mockReset();
    await query(`truncate meetings, calendar_events, team_memberships, meeting_access cascade;
      insert into team_memberships values ('${teamId}', '${userId}', 'member');
      insert into calendar_events values ('${eventId}', '${teamId}', '2026-10-19T15:30:00Z', '2026-10-19T17:00:00Z');
      insert into meetings (id, team_id, owner_user_id, title, platform, status, calendar_event_id, started_at, ended_at, organization_access_enabled)
        values ('${meetingId}', '${teamId}', '${userId}', 'Calendar title', 'google_meet', 'scheduled', '${eventId}', '2026-10-19T15:30:00Z', '2026-10-19T17:00:00Z', true);`);
  });
  afterAll(async () => { await query(`drop schema ${schema} cascade; drop role if exists ${restrictedRole}`); });

  it.each(["audio", "video"] as const)("imports %s without changing calendar identity or sharing, and replays the same object", async (kind) => {
    const result = await importUploadedRecording({ ...base, kind, title: "Do not replace title" });
    expect(result.meetingId).toBe(meetingId);
    expect(await query("select title, platform, owner_user_id, started_at, ended_at, organization_access_enabled from meetings")).toEqual([{
      title: "Calendar title", platform: "google_meet", owner_user_id: userId, started_at: new Date("2026-10-19T15:30:00Z"),
      ended_at: new Date("2026-10-19T17:00:00Z"), organization_access_enabled: true,
    }]);
    expect(await query("select started_at, duration_ms from recordings")).toEqual([{ started_at: startedAt, duration_ms: 5127900 }]);
    expect(await query("select media_asset_id from transcript_jobs")).toEqual([{ media_asset_id: kind === "audio" ? result.mediaAssetId : null }]);
    expect(await importUploadedRecording({ ...base, kind })).toEqual(result);
    expect(await query("select count(*)::int as n from recordings")).toEqual([{ n: 1 }]);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("creates new uploads under the stable meeting-child RLS policy", async () => {
    await query(`create role ${restrictedRole};
      grant usage on schema ${schema} to ${restrictedRole};
      grant select, insert, update on all tables in schema ${schema} to ${restrictedRole};
      create function ${schema}.can_write_meeting(target uuid) returns boolean language sql stable security definer
        as 'select exists(select 1 from ${schema}.meetings where id = target and owner_user_id = ''${userId}'')';
      alter table recordings enable row level security;
      create policy import_write on recordings for all to ${restrictedRole}
        using (${schema}.can_write_meeting(meeting_id)) with check (${schema}.can_write_meeting(meeting_id));`);
    useRestrictedRole = true;
    try {
      const result = await importUploadedRecording({ ...base, meetingId: undefined });
      expect(result.meetingId).not.toBe(meetingId);
      expect(await query("select count(*)::int as n from recordings")).toEqual([{ n: 1 }]);
    } finally { useRestrictedRole = false; }
  });

  it("rolls back meeting status and all records when a dependent asset insert fails", async () => {
    await query("alter table media_assets add constraint import_test_size check (file_size_bytes < 100)");
    try {
      await expect(importUploadedRecording({ ...base, fileSizeBytes: 999 })).rejects.toThrow();
      expect(await query("select status from meetings")).toEqual([{ status: "scheduled" }]);
      expect(await query("select count(*)::int as n from recordings")).toEqual([{ n: 0 }]);
      expect(await query("select count(*)::int as n from transcript_jobs")).toEqual([{ n: 0 }]);
    } finally { await query("alter table media_assets drop constraint import_test_size"); }
  });

  it("creates one new meeting across concurrent replays of the same object", async () => {
    const [first, second] = await Promise.all([importUploadedRecording({ ...base, meetingId: undefined }), importUploadedRecording({ ...base, meetingId: undefined })]);
    expect(first).toEqual(second);
    expect(await query("select count(*)::int as n from recordings")).toEqual([{ n: 1 }]);
    expect(await query("select count(*)::int as n from meetings where platform = 'upload'")).toEqual([{ n: 1 }]);
  });

  it("allows only one concurrent import into an empty destination", async () => {
    const results = await Promise.allSettled([importUploadedRecording(base), importUploadedRecording({ ...base, objectKey: "other.mp3" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await query("select count(*)::int as n from recordings")).toEqual([{ n: 1 }]);
  });

  it("serializes import against a recorder starting on the same target", async () => {
    const results = await Promise.allSettled([
      importUploadedRecording(base),
      setLocalRecorderRecordingTarget({ workspace, meetingId, deviceId: "test-mac", now: new Date() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("serializes import against a notified recorder intent with a stale eligibility read", async () => {
    const now = new Date();
    const attemptId = randomUUID();
    const hash = (value: string) => createHash("sha256").update(value).digest("base64url");
    await query("insert into local_recording_attempts(id,meeting_id,user_id,device_id_hash,fallback_intent_id_hash,attempt_state,expires_at) values ($1,$2,$3,$4,$5,'notified',$6)", [attemptId, meetingId, userId, hash("legacy-mac"), hash("legacy-intent"), new Date(now.getTime() + 60 * 60 * 1000)]);
    const rows = (data: unknown[]) => {
      const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: async () => data };
      return chain;
    };
    db.select.mockReturnValueOnce(rows([{
      id: attemptId, attemptState: "notified", activeTranscriptJob: false,
      meetingId, meetingUrl: "https://meet.google.com/abc-defg-hij", title: "Calendar title", status: "scheduled",
      startedAt: new Date(now.getTime() - 10 * 60 * 1000), endedAt: new Date(now.getTime() + 30 * 60 * 1000),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000), recallAudioAsset: false, recallRecordingId: null,
    }])).mockReturnValueOnce(rows([]));
    const [imported, claimed] = await Promise.allSettled([
      importUploadedRecording(base),
      claimLocalRecorderIntent({ workspace, deviceId: "legacy-mac", fallbackIntentId: "legacy-intent", now }),
    ]);
    expect(claimed.status).toBe("fulfilled");
    if (claimed.status === "fulfilled") {
      if (claimed.value.claimed) expect(imported.status).toBe("rejected");
      else expect(imported.status).toBe("fulfilled");
    }
    const recordings = await query("select count(*)::int as n from recordings");
    const active = await query("select count(*)::int as n from local_recording_attempts where attempt_state='started'");
    expect(recordings[0].n + active[0].n).toBe(1);
  });

  it("allows local recording resume during local transcription but rejects an in-flight upload import", async () => {
    await query("update meetings set status = 'processing'");
    await query("insert into recordings(id,meeting_id,source) values ($1,$2,'local')", [randomUUID(), meetingId]);
    await expect(setLocalRecorderRecordingTarget({ workspace, meetingId, deviceId: "resume-mac", now: new Date() })).resolves.toMatchObject({ meetingId });
    await query("delete from local_recording_attempts; update recordings set source = 'upload'");
    await expect(setLocalRecorderRecordingTarget({ workspace, meetingId, deviceId: "resume-mac", now: new Date() })).rejects.toThrow("unavailable");
  });

  it("rechecks permissions after waiting for the target lock", async () => {
    const locker = await connect();
    await locker.query("begin");
    await locker.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`recording-timeline:${meetingId}`]);
    const pending = importUploadedRecording(base);
    const denied = expect(pending).rejects.toMatchObject({ status: 403 });
    try {
      await locker.query("update meetings set owner_user_id = $1 where id = $2", [otherId, meetingId]);
      await locker.query("commit");
      await denied;
      expect(await query("select count(*)::int as n from recordings")).toEqual([{ n: 0 }]);
    } finally { await locker.end(); }
  });

  it.each([
    "update meetings set status = 'processing'",
    "update meetings set status = 'recording'",
    "update meetings set bot_state = 'joining'",
    "update meetings set recall_bot_id = 'bot'",
    "update meetings set recall_recording_id = 'capture'",
    "insert into recordings(id, meeting_id) select gen_random_uuid(), id from meetings",
    "insert into media_assets(id, meeting_id) select gen_random_uuid(), id from meetings",
    "insert into transcript_jobs(id, meeting_id, status) select gen_random_uuid(), id, 'failed' from meetings",
    "insert into transcript_segments(meeting_id) select id from meetings",
    "insert into local_recordings(meeting_id) select id from meetings",
    "insert into local_recording_attempts(meeting_id, attempt_state) select id, 'sealed' from meetings",
    "insert into local_recording_attempts(meeting_id, attempt_state) select id, 'uploading' from meetings",
    "insert into local_recording_attempts(meeting_id, attempt_state, expires_at) select id, 'started', now() + interval '1 hour' from meetings",
  ])("rejects unavailable target without a partial asset: %s", async (mutation) => {
    await query(mutation);
    const before = await query("select count(*)::int as n from media_assets");
    await expect(importUploadedRecording(base)).rejects.toMatchObject({ status: 409 });
    expect(await query("select count(*)::int as n from media_assets")).toEqual(before);
  });

  it("denies another member and another workspace, and refuses replay to a different destination", async () => {
    await expect(importUploadedRecording({ ...base, workspace: { ...workspace, userId: otherId } })).rejects.toMatchObject({ status: 403 });
    await expect(importUploadedRecording({ ...base, workspace: { ...workspace, teamId: otherId } })).rejects.toMatchObject({ status: 403 });
    await importUploadedRecording(base);
    await query("insert into meetings(id,team_id,owner_user_id,title,platform,status,calendar_event_id) values ($1,$2,$3,'Other','google_meet','scheduled',$4)", [otherId, teamId, userId, eventId]);
    await expect(importUploadedRecording({ ...base, meetingId: otherId })).rejects.toMatchObject({ status: 409 });
    expect(await query("select count(*)::int as n from recordings")).toEqual([{ n: 1 }]);
  });

  it("lists calendar meetings by overlap, limits results, and hides unrelated admin meetings", async () => {
    await query("update team_memberships set role='admin'");
    for (let i = 0; i < 22; i++) await query("insert into meetings(id,team_id,owner_user_id,title,platform,status,calendar_event_id,started_at,ended_at) values ($1,$2,$3,$4,'google_meet','scheduled',$5,'2026-10-19T16:00:00Z','2026-10-19T17:00:00Z')", [randomUUID(), teamId, userId, `Meeting ${i}`, eventId]);
    await query("insert into meetings(id,team_id,owner_user_id,title,platform,status,calendar_event_id,started_at) values ($1,$2,$3,'Private teammate meeting','google_meet','scheduled',$4,'2026-10-19T15:41:00Z')", [otherId, teamId, otherId, eventId]);
    const result = await listUploadMeetingCandidates({ workspace, startedAt, durationMs: 5127900 });
    expect(result.hasMore).toBe(true);
    expect(result.meetings).toHaveLength(20);
    expect(result.meetings[0].id).toBe(meetingId);
    expect(result.meetings.some((m) => m.id === otherId)).toBe(false);
    await importUploadedRecording(base);
    expect((await listUploadMeetingCandidates({ workspace, startedAt })).meetings[0].unavailableReason).toBeTruthy();
    expect((await listUploadMeetingCandidates({ workspace, startedAt: new Date("2026-11-01T12:00:00Z") })).meetings).toEqual([]);
  });
});
