import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { databaseSql, db } = vi.hoisted(() => ({ databaseSql: Object.assign(vi.fn(), { transaction: vi.fn() }), db: { select: vi.fn() } }));
vi.mock("@/db/client", () => ({ databaseSql, db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: vi.fn() } }));
vi.mock("@/lib/meeting-share-rules", () => ({ reconcileMeetingSharingForMeeting: vi.fn() }));
vi.mock("@/lib/r2", () => ({
  buildMeetingObjectKey: ({ meetingId, assetId }: { meetingId: string; assetId: string }) => `${meetingId}/${assetId}`,
  createUploadUrl: vi.fn(), getObjectMetadata: vi.fn(async () => ({ contentLength: 100, contentType: "audio/wav" })), parseR2Env: () => ({ R2_BUCKET: "test" }),
}));
vi.mock("@/lib/vendors/recall", () => ({ createRecallDesktopSdkUpload: vi.fn(), getRecallApiBaseUrl: vi.fn(), retrieveRecallBot: vi.fn() }));
import { claimLocalRecorderIntent, completeLocalRecorderRecordingUpload, resolveLocalRecorderSdkMeeting } from "@/lib/local-recorder-records";
import { finishLocalRecorderRecordingTarget, listLocalRecorderRecordingMeetings, setLocalRecorderRecordingTarget } from "@/lib/local-recorder-targets";

const dsn = process.env.TAPE_RECORDER_TEST_DATABASE;
const run = promisify(execFile);
const team = "00000000-0000-4000-8000-000000000001";
const user = "00000000-0000-4000-8000-000000000002";
const other = "00000000-0000-4000-8000-000000000003";
const first = "00000000-0000-4000-8000-000000000004";
const second = "00000000-0000-4000-8000-000000000005";
const workspace = { teamId: team, userId: user, domain: "", canCreateMeetings: true };
const input = { workspace, deviceId: "mac", now: new Date(), meetingId: first };
const schema = `recorder_test_${process.pid}`;

function literal(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `'${text.replaceAll("'", "''")}'`;
}
function statement(strings: TemplateStringsArray, ...values: unknown[]) {
  return strings.reduce((text, part, i) => text + (i ? literal(values[i - 1]) : "") + part, "");
}
async function sql(query: string) {
  const result = await run("psql", [dsn!, "-X", "-q", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", `set search_path to ${schema}; ${query}`]);
  return result.stdout.trim().split("\n").filter(Boolean);
}
function targetRows(lines: string[]) {
  return lines.map((line) => {
    const [meetingId, meetingTitle, startsAt, endsAt] = line.split("|");
    return { meetingId, meetingTitle, startsAt: startsAt || null, endsAt: endsAt || null };
  });
}

describe.skipIf(!dsn)("recording target PostgreSQL transactions", () => {
  beforeAll(async () => {
    const url = new URL(dsn!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/tape_workflow_test") throw new Error("Use the isolated local tape_workflow_test database");
    await sql(`create schema ${schema};
      create table team_memberships (team_id uuid, user_id uuid, role text);
      create table meetings (id uuid primary key default gen_random_uuid(), team_id uuid, owner_user_id uuid, platform text, status text, title text, started_at timestamptz, ended_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), recall_bot_id text);
      create table local_recording_attempts (id uuid primary key default gen_random_uuid(), meeting_id uuid references meetings(id), user_id uuid, device_id_hash text, fallback_intent_id_hash text unique, attempt_state text, claimed_at timestamptz, expires_at timestamptz, notification_state text, updated_at timestamptz default now());
      create unique index local_recording_attempts_primary_active_unique on local_recording_attempts(meeting_id) where attempt_state in ('started', 'uploading', 'uploaded');
      create type asset_type as enum ('computer_audio', 'microphone_audio', 'synthesized_audio');
      create table media_assets (id uuid primary key, meeting_id uuid references meetings(id), source text, type asset_type, bucket text, object_key text, mime_type text, file_size_bytes integer);
      create table local_recordings (id uuid primary key default gen_random_uuid(), local_recording_attempt_id uuid unique references local_recording_attempts(id), meeting_id uuid references meetings(id), is_primary boolean, owner_user_id uuid, client_recording_id text, recording_started_at timestamptz, recording_stopped_at timestamptz, computer_audio_asset_id uuid references media_assets(id), microphone_audio_asset_id uuid references media_assets(id), synthesized_audio_asset_id uuid references media_assets(id), manifest jsonb, synthesis_status text, updated_at timestamptz, unique(owner_user_id, client_recording_id));
      create unique index local_recordings_meeting_primary_unique on local_recordings(meeting_id) where is_primary = true;
      create table recordings (id uuid primary key, meeting_id uuid references meetings(id), source text, started_at timestamptz, ended_at timestamptz, duration_ms integer, updated_at timestamptz);
      create table transcript_jobs (id uuid primary key, meeting_id uuid references meetings(id), recording_id uuid references recordings(id), media_asset_id uuid references media_assets(id), provider text, status text, mode text default 'replace', updated_at timestamptz);
      create unique index transcript_jobs_recording_unique on transcript_jobs(recording_id) where recording_id is not null;
    `);
    databaseSql.mockImplementation(async (...args) => {
      const query = statement(...args as [TemplateStringsArray, ...unknown[]]);
      const lines = await sql(query);
      if (query.includes('m.status\n')) return lines.map((line) => {
        const [meetingId, title, startsAt, endsAt, status] = line.split("|");
        return { meetingId, title, startsAt: startsAt || null, endsAt: endsAt || null, status };
      });
      if (query.includes("local_recording_id,")) return lines.map((line) => {
        const [local_recording_id, transcript_job_id, meeting_id, media_asset_id] = line.split("|");
        return { local_recording_id, transcript_job_id, meeting_id, media_asset_id };
      });
      if (query.includes("returning meeting_id") && !query.includes('"meetingTitle"')) return lines.map((meeting_id) => ({ meeting_id }));
      return targetRows(lines);
    });
    databaseSql.transaction.mockImplementation(async (build) => {
      const queries = build(statement);
      const result = await run("psql", [dsn!, "-X", "-q", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", `set search_path to ${schema}`, "-c", "begin", ...queries.flatMap((query: string) => ["-c", query]), "-c", "commit"]);
      const lines = result.stdout.trim().split("\n").filter(Boolean);
      if (queries.length === 2) return [[], lines.map((line) => {
        const [local_recording_id, transcript_job_id, meeting_id, media_asset_id] = line.split("|");
        return { local_recording_id, transcript_job_id, meeting_id, media_asset_id };
      })];
      return [[], [], targetRows(lines)];
    });
  });
  beforeEach(async () => {
    db.select.mockReset();
    await sql(`truncate transcript_jobs, recordings, local_recordings, media_assets, local_recording_attempts, meetings, team_memberships;
      insert into team_memberships values ('${team}', '${user}', 'member');
      insert into meetings(id, team_id, owner_user_id, title, platform, status, started_at) values
      ('${first}', '${team}', '${user}', 'First', 'google_meet', 'ready', '2020-01-01'),
      ('${second}', '${team}', '${user}', 'Second', 'zoom', 'scheduled', now());`);
  });
  afterAll(async () => { await sql(`drop schema ${schema} cascade`); });

  it("creates, switches repeatedly with the same token and preserves old meeting dates and data", async () => {
    const original = await sql(`select row_to_json(m) from meetings m where id = '${first}'`);
    const started = await setLocalRecorderRecordingTarget(input);
    const switched = await setLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId, meetingId: second });
    const repeated = await setLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId, meetingId: second });
    expect(switched.fallbackIntentId).toBe(started.fallbackIntentId);
    expect(repeated).toEqual(switched);
    expect(await sql(`select row_to_json(m) from meetings m where id = '${first}'`)).toEqual(original);
    const created = await setLocalRecorderRecordingTarget({ ...input, meetingId: undefined, fallbackIntentId: started.fallbackIntentId, title: "New meeting" });
    expect(created.meetingTitle).toBe("New meeting");
    expect(created.startsAt).toBeNull();
    expect(await sql("select count(*) from local_recording_attempts")).toEqual(["1"]);
  });

  it("freezes assignment, allows immediate resume and rejects a late switch", async () => {
    const started = await setLocalRecorderRecordingTarget(input);
    await finishLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId });
    await finishLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId });
    const resumed = await setLocalRecorderRecordingTarget(input);
    expect(resumed.fallbackIntentId).not.toBe(started.fallbackIntentId);
    await expect(setLocalRecorderRecordingTarget({ ...input, meetingId: second, fallbackIntentId: started.fallbackIntentId })).rejects.toThrow("unavailable");
    expect(await sql("select attempt_state from local_recording_attempts order by attempt_state")).toEqual(["sealed", "started"]);
  });

  it("allows exactly one concurrent start and rolls back losing new meeting creation", async () => {
    const results = await Promise.allSettled([
      setLocalRecorderRecordingTarget({ ...input, meetingId: undefined, title: "A" }),
      setLocalRecorderRecordingTarget({ ...input, meetingId: undefined, title: "B" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await sql("select count(*) from meetings")).toEqual(["3"]);
  });

  it("serializes switch versus finish to one frozen destination", async () => {
    const started = await setLocalRecorderRecordingTarget(input);
    const [switchResult, finishResult] = await Promise.allSettled([
      setLocalRecorderRecordingTarget({ ...input, meetingId: second, fallbackIntentId: started.fallbackIntentId }),
      finishLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId }),
    ]);
    expect(finishResult.status).toBe("fulfilled");
    if (finishResult.status === "fulfilled") {
      expect(finishResult.value.meetingId).toBe(switchResult.status === "fulfilled" ? second : first);
      expect(await sql("select meeting_id from local_recording_attempts")).toEqual([finishResult.value.meetingId]);
    }
  });

  it("retains all media on resumed completion and creates only append jobs", async () => {
    const complete = async (fallbackIntentId: string) => {
      const [line] = await sql("select id, meeting_id, attempt_state, expires_at from local_recording_attempts where attempt_state = 'sealed' order by claimed_at desc limit 1");
      const [id, meetingId, attemptState, expiresAt] = line.split("|");
      const rows = (data: unknown[]) => {
        const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: async () => data };
        return chain;
      };
      db.select.mockReturnValueOnce(rows([])).mockReturnValueOnce(rows([{ id, meetingId, attemptState, expiresAt: new Date(expiresAt) }]));
      return completeLocalRecorderRecordingUpload({ ...input, fallbackIntentId, clientRecordingId: randomUUID(), manifest: {}, recordingStartedAt: input.now, recordingStoppedAt: new Date(input.now.getTime() + 1000), assets: { computerAudioAssetId: randomUUID(), microphoneAudioAssetId: randomUUID(), synthesizedAudioAssetId: randomUUID() } });
    };
    const a = await setLocalRecorderRecordingTarget(input);
    await finishLocalRecorderRecordingTarget({ ...input, fallbackIntentId: a.fallbackIntentId });
    const b = await setLocalRecorderRecordingTarget({ ...input, now: new Date(input.now.getTime() + 1000) });
    await complete(a.fallbackIntentId);
    expect(await sql("select count(*) from local_recording_attempts where attempt_state = 'started'")).toEqual(["1"]);
    await finishLocalRecorderRecordingTarget({ ...input, fallbackIntentId: b.fallbackIntentId });
    await complete(b.fallbackIntentId);
    expect(await sql("select count(*) from media_assets")).toEqual(["6"]);
    expect(await sql("select count(*) from recordings")).toEqual(["2"]);
    expect(await sql("select count(*) from local_recordings where is_primary")).toEqual(["1"]);
    expect(await sql("select mode from transcript_jobs")).toEqual(["append", "append"]);
  });

  it("resolves SDK completion through the reassigned attempt and freezes it", async () => {
    const started = await setLocalRecorderRecordingTarget(input);
    await setLocalRecorderRecordingTarget({ ...input, meetingId: second, fallbackIntentId: started.fallbackIntentId });
    expect(await resolveLocalRecorderSdkMeeting(started.fallbackIntentId)).toBe(second);
    expect(await resolveLocalRecorderSdkMeeting(started.fallbackIntentId)).toBe(second);
    await expect(setLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId })).rejects.toThrow("unavailable");
    expect(await sql("select attempt_state from local_recording_attempts")).toEqual(["sealed"]);
  });

  it.each(["sealed", "completed"])("cannot reopen %s through a claim that read the old active state", async (state) => {
    const started = await setLocalRecorderRecordingTarget(input);
    const [id] = await sql("select id from local_recording_attempts");
    await finishLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId });
    if (state === "completed") await sql("update local_recording_attempts set attempt_state = 'completed'");
    const rows = (data: unknown[]) => {
      const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, limit: async () => data };
      return chain;
    };
    db.select.mockReturnValueOnce(rows([{
      id, meetingId: first, attemptState: "started", activeTranscriptJob: false,
      expiresAt: new Date(input.now.getTime() + 60_000), startedAt: new Date(input.now.getTime() - 5 * 60_000), endedAt: null,
      meetingUrl: "https://meet.google.com/abc-defg-hij", recallAudioAsset: false, recallRecordingId: null, status: "scheduled", title: "First",
    }])).mockReturnValueOnce(rows([]));
    await expect(claimLocalRecorderIntent({ ...input, fallbackIntentId: started.fallbackIntentId })).resolves.toEqual({ claimed: false, reason: "expired_or_missing" });
    expect(await sql("select attempt_state from local_recording_attempts")).toEqual([state]);
    await expect(setLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId, meetingId: second })).rejects.toThrow("unavailable");
  });

  it("does not grant write access to another member and rejects foreign device, cancelled and completed attempts", async () => {
    await sql(`update meetings set owner_user_id = '${other}' where id = '${second}'`);
    const inventory = await listLocalRecorderRecordingMeetings({ workspace, query: "" });
    expect(inventory.meetings.map((item) => item.meetingId)).toEqual([first]);
    await expect(setLocalRecorderRecordingTarget({ ...input, meetingId: second })).rejects.toThrow("unavailable");
    const started = await setLocalRecorderRecordingTarget(input);
    await expect(setLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId, deviceId: "other" })).rejects.toThrow("unavailable");
    await sql(`update local_recording_attempts set attempt_state = 'completed'`);
    await expect(setLocalRecorderRecordingTarget({ ...input, fallbackIntentId: started.fallbackIntentId })).rejects.toThrow("unavailable");
    await sql(`update meetings set status = 'cancelled' where id = '${first}'`);
    await expect(setLocalRecorderRecordingTarget(input)).rejects.toThrow("unavailable");
  });
});
