import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { select, update } = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select, update } }));
import { listPendingMeetingEmails, loadMeetingEmailSnapshot, isMeetingEmailCurrent, markMeetingEmailSent, prepareMeetingEmail } from "@/lib/meeting-email-records";

const meetingId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const meeting = { title: "Meeting", recipientEmail: "owner@example.com" };
const job = () => ({ id: jobId, status: "completed", mode: "replace", createdAt: new Date("2026-10-22T00:00:00Z"), payload: null, preparedAt: null, sentAt: null });
const segments = [{ startMs: 0, speaker: "Jocy", text: "Ship Monday." }];
const payload = { from: "tape@inevitable.tech", to: [meeting.recipientEmail], subject: "Meeting", text: "Ready", attachments: [] };

function mockRows(...rows: unknown[][]) {
  const conditions: unknown[] = [];
  for (const result of rows) {
    const chain = {
      from: () => chain, innerJoin: () => chain, orderBy: () => chain, limit: () => chain,
      where: (condition: unknown) => { conditions.push(condition); return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    select.mockReturnValueOnce(chain);
  }
  return conditions;
}
afterEach(() => vi.resetAllMocks());

describe("meeting email records", () => {
  it("bounds the outbox scan and correlates active generations to the outer meeting", async () => {
    const conditions = mockRows([{ meetingId, transcriptJobId: jobId }]);
    expect(await listPendingMeetingEmails()).toEqual([{ meetingId, transcriptJobId: jobId }]);
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(conditions[0] as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(query.sql).toContain('"email_jobs"."completion_email_ready_at" is not null');
    expect(query.sql).toContain('"email_jobs"."completion_email_sent_at" is null');
    expect(query.sql).toContain('where meeting_id = "email_jobs"."meeting_id"');
    expect(query.sql).toContain("pending_part.status <> 'completed'");
    expect(query.sql).toContain("interval '23 hours'");
    expect(query.sql).not.toContain('where meeting_id = "transcript_jobs"."meeting_id"');
  });

  it("reads the recipient from the meeting owner and restricts segments to active jobs", async () => {
    const conditions = mockRows([meeting], [job()], segments);
    const result = await loadMeetingEmailSnapshot({ meetingId, transcriptJobId: jobId });
    expect(result).toMatchObject({ action: "ready", recipientEmail: meeting.recipientEmail, anchorId: jobId, segments });
    const dialect = new PgDialect();
    const jobsSql = dialect.sqlToQuery(conditions[1] as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(jobsSql.sql).toContain("latest_replace");
    expect(jobsSql.params).toContain(meetingId);
    const segmentsSql = dialect.sqlToQuery(conditions[2] as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(segmentsSql.params).toEqual([meetingId, jobId]);
  });

  it("waits for all batch jobs, including queued append jobs", async () => {
    mockRows([meeting], [job(), { ...job(), id: "part-two", mode: "append", status: "queued" }]);
    expect(await loadMeetingEmailSnapshot({ meetingId, transcriptJobId: jobId })).toEqual({ action: "waiting" });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("ignores a superseded job and does not load its segments", async () => {
    mockRows([meeting], [job()]);
    expect(await loadMeetingEmailSnapshot({ meetingId, transcriptJobId: "other-job" })).toEqual({ action: "skipped", reason: "transcript_superseded" });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("skips a deleted meeting", async () => {
    mockRows([]);
    expect(await loadMeetingEmailSnapshot({ meetingId })).toEqual({ action: "skipped", reason: "meeting_deleted" });
  });

  it("skips an already sent recording without using provider key retention", async () => {
    mockRows([meeting], [{ ...job(), sentAt: new Date("2020-01-01") }]);
    expect(await loadMeetingEmailSnapshot({ meetingId, transcriptJobId: jobId })).toEqual({ action: "skipped", reason: "already_sent" });
  });

  it("does not send partial transcripts when a part fails", async () => {
    mockRows([meeting], [{ ...job(), status: "failed" }]);
    expect(await loadMeetingEmailSnapshot({ meetingId, transcriptJobId: jobId })).toEqual({ action: "skipped", reason: "transcription_failed" });
  });

  it("rejects a snapshot after the owner email changes", async () => {
    mockRows([meeting], [job()], segments);
    const snapshot = await loadMeetingEmailSnapshot({ meetingId, transcriptJobId: jobId });
    if (snapshot.action !== "ready") throw new Error("expected ready snapshot");
    mockRows([{ ...meeting, recipientEmail: "new@example.com" }], [job()], segments);
    expect(await isMeetingEmailCurrent(snapshot)).toBe(false);
  });

  it("freezes the exact payload atomically and keeps the original on concurrent preparation", async () => {
    mockRows([meeting], [job()], segments);
    const snapshot = await loadMeetingEmailSnapshot({ meetingId, transcriptJobId: jobId });
    if (snapshot.action !== "ready") throw new Error("expected ready snapshot");
    mockRows([meeting], [job()], segments);
    const stored = { payload, jobIds: [jobId] };
    const returning = vi.fn().mockResolvedValue([{ payload: stored, preparedAt: new Date("2026-10-22T00:00:00Z") }]);
    const set = vi.fn().mockReturnValue({ where: () => ({ returning }) });
    update.mockReturnValue({ set });
    expect(await prepareMeetingEmail(snapshot, payload)).toEqual({ ...stored, preparedAt: "2026-10-22T00:00:00.000Z" });
    const dialect = new PgDialect();
    const frozenSql = dialect.sqlToQuery(set.mock.calls[0][0].completionEmailPayload);
    expect(frozenSql.sql).toContain("coalesce");
    expect(JSON.parse(frozenSql.params[0] as string)).toEqual(stored);
  });

  it("persists the receipt and removes the duplicate private attachment data", async () => {
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    update.mockReturnValue({ set });
    await markMeetingEmailSent(jobId, "provider-id");
    expect(set).toHaveBeenCalledWith({ completionEmailId: "provider-id", completionEmailSentAt: expect.any(Date), completionEmailPayload: null });
  });
});
