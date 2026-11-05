import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return { get db() { return drizzle(state.pool!); } };
});
import { getRecentMeetingCompanies } from "@/lib/recent-meeting-companies";
import { acquireFollowupLease, releaseFollowupLease } from "@/lib/meeting-followup-lease";
const url = process.env.FOLLOWUP_TEST_DATABASE_URL;
const schema = "followup_" + randomUUID().replaceAll("-", "");
const meetingId = randomUUID();
describe.skipIf(!url)("shared followup in PostgreSQL", () => {
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Use an isolated local database");
    state.pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await state.pool.query(`create schema ${schema}; create table users(id uuid primary key); create table meetings(id uuid primary key, translation_language text, owner_user_id uuid, title text, started_at timestamptz, created_at timestamptz default now(), status text); create table meeting_attendees(meeting_id uuid, email text); create table calendar_connections(id uuid primary key, user_id uuid); create table calendar_events(id uuid primary key, connection_id uuid, title text, attendee_emails jsonb, starts_at timestamptz); create table transcript_segments(meeting_id uuid, translated_text text)`);
    await state.pool.query("insert into meetings values ($1, 'en')", [meetingId]);
    await state.pool.query("insert into transcript_segments values ($1, 'Hello')", [meetingId]);
    await state.pool.query(readFileSync("db/migrations/0068_user_language_shared_followup.sql", "utf8"));
  });
  afterAll(async () => { if (state.pool) { await state.pool.query(`drop schema ${schema} cascade`); await state.pool.end(); } });
  it("backfills existing transcript translations", async () => {
    const { rows } = await state.pool!.query("select translation_copies from transcript_segments");
    expect(rows[0].translation_copies).toEqual({ en: "Hello" });
  });
  it("reads the owner’s latest companies across captured and calendar meetings, even after a page of repeats", async () => {
    const owner = randomUUID();
    const connection = randomUUID();
    await state.pool!.query("insert into calendar_connections values ($1, $2)", [connection, owner]);
    await state.pool!.query("insert into calendar_events select gen_random_uuid(), $1, 'Weekly sync', '[\"user@acme.com\",\"person@gmail.com\"]', now() - interval '1 day' from generate_series(1,210)", [connection]);
    await state.pool!.query("insert into meetings(id, owner_user_id, title, started_at, status) values ($1, $2, 'Aperture', now() - interval '2 days', 'ready'), ($3, $4, 'Private Corp', now(), 'ready')", [randomUUID(), owner, randomUUID(), randomUUID()]);
    expect(await getRecentMeetingCompanies(owner)).toEqual(["acme.com", "Aperture"]);
  });
  it("admits one racing generator, recovers an expired lease and ignores a stale release", async () => {
    const claims = await Promise.all(Array.from({ length: 8 }, () => acquireFollowupLease(meetingId)));
    const tokens = claims.filter(token => token !== null);
    expect(tokens).toHaveLength(1);
    await state.pool!.query("update meetings set followup_lease_expires_at = now() - interval '1 second'");
    const replacement = await acquireFollowupLease(meetingId);
    expect(replacement).toBeTruthy();
    await releaseFollowupLease(meetingId, tokens[0]);
    expect(await acquireFollowupLease(meetingId)).toBeNull();
    await releaseFollowupLease(meetingId, replacement!);
    expect(await acquireFollowupLease(meetingId)).toBeTruthy();
  });
});
