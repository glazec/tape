import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordingTimelineRebaseQuery } from "@/lib/recording-timeline";

const dsn = process.env.TAPE_RECORDER_TEST_DATABASE;
const run = promisify(execFile);
const schema = `recording_timeline_test_${process.pid}`;
const meeting = "00000000-0000-4000-8000-000000000001";
const a = "00000000-0000-4000-8000-000000000002";
const b = "00000000-0000-4000-8000-000000000003";
const c = "00000000-0000-4000-8000-000000000004";
const sa = "00000000-0000-4000-8000-000000000005";
const sb = "00000000-0000-4000-8000-000000000006";
async function execute(statement: string) {
  const result = await run("psql", [dsn!, "-X", "-q", "-t", "-A", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", `set search_path to ${schema}; ${statement}`]);
  return result.stdout.trim().split("\n").filter(Boolean);
}
function rebase() {
  const query = new PgDialect().sqlToQuery(recordingTimelineRebaseQuery(meeting));
  return query.sql.replace(/\$(\d+)/g, (_, index) => `'${String(query.params[Number(index) - 1]).replaceAll("'", "''")}'`);
}
describe.skipIf(!dsn)("recording timeline PostgreSQL rebasing", () => {
  beforeAll(async () => {
    const url = new URL(dsn!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/tape_workflow_test") throw new Error("Use the isolated local tape_workflow_test database");
    await execute(`create schema ${schema};
      create table recordings(id uuid primary key, started_at timestamptz, duration_ms integer);
      create table transcript_jobs(id uuid primary key, recording_id uuid references recordings(id), meeting_id uuid, created_at timestamptz, mode text, generation_id uuid, recording_offset_ms integer);
      create table transcript_segments(id uuid primary key, job_id uuid references transcript_jobs(id), start_ms integer, end_ms integer, text text, translated_text text);`);
  });
  beforeEach(async () => { await execute("truncate transcript_segments, transcript_jobs, recordings"); });
  afterAll(async () => { await execute(`drop schema ${schema} cascade`); });

  it("rebases B already transcribed before A without changing edits or segment identities", async () => {
    await execute(`insert into recordings values ('${b}', '2026-10-30 12:10Z', 20000);
      insert into transcript_jobs values ('${b}', '${b}', '${meeting}', '2026-10-30 12:12Z', 'append', null, 0);
      insert into transcript_segments values ('${sb}', '${b}', 500, 1500, 'B edited', 'B translated'); ${rebase()}`);
    await execute(`begin;
      insert into recordings values ('${a}', '2026-10-30 12:00Z', 600000);
      insert into transcript_jobs values ('${a}', '${a}', '${meeting}', '2026-10-30 12:20Z', 'append', null, 0);
      insert into transcript_segments values ('${sa}', '${a}', 1000, 2000, 'A original', 'A translated');
      ${rebase()}; commit;`);
    expect(await execute("select id, text, translated_text, start_ms, end_ms from transcript_segments order by start_ms")).toEqual([
      `${sa}|A original|A translated|1000|2000`, `${sb}|B edited|B translated|600500|601500`,
    ]);
    expect(await execute("select recording_id from transcript_jobs job join recordings recording on recording.id = job.recording_id order by coalesce(recording.started_at, job.created_at), job.created_at, job.id")).toEqual([a, b]);
    await execute(rebase());
    expect(await execute(`select start_ms from transcript_segments where id = '${sb}'`)).toEqual(["600500"]);
  });

  it("keeps replacement generations excluded and derives legacy offsets without wall clock overlap", async () => {
    await execute(`insert into recordings values ('${a}', '2026-10-30 12:00Z', 999999), ('${b}', '2026-10-30 13:00Z', 10000), ('${c}', '2026-10-30 13:00:05Z', 5000);
      insert into transcript_jobs values
        ('${a}', '${a}', '${meeting}', '2026-10-30 12:00Z', 'replace', null, null),
        ('${b}', '${b}', '${meeting}', '2026-10-30 13:01Z', 'replace', null, null),
        ('${c}', '${c}', '${meeting}', '2026-10-30 13:02Z', 'append', null, null);
      insert into transcript_segments values ('${sa}', '${a}', 100, 200, 'old generation', null), ('${sb}', '${c}', 10200, 10300, 'overlap', null);
      ${rebase()}`);
    expect(await execute(`select start_ms from transcript_segments where id = '${sa}'`)).toEqual(["100"]);
    expect(await execute(`select start_ms from transcript_segments where id = '${sb}'`)).toEqual(["10200"]);
    expect(await execute(`select recording_offset_ms from transcript_jobs where id = '${c}'`)).toEqual(["10000"]);
    expect(await execute(`select recording_offset_ms is null from transcript_jobs where id = '${a}'`)).toEqual(["t"]);
  });
});
