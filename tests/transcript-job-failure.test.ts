import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const { update } = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { update },
}));

const dialect = new PgDialect();

describe("safe transcript job failure", () => {
  afterEach(() => {
    update.mockReset();
    vi.resetModules();
  });

  it("fails the meeting only while this is the last viable job", async () => {
    const jobReturning = vi.fn().mockResolvedValue([{ id: "job_123" }]);
    const jobWhere = vi.fn((condition: SQL) => {
      void condition;

      return { returning: jobReturning };
    });
    const jobSet = vi.fn(() => ({ where: jobWhere }));
    const meetingWhere = vi.fn().mockResolvedValue(undefined);
    const meetingSet = vi.fn(() => ({ where: meetingWhere }));
    update
      .mockReturnValueOnce({ set: jobSet })
      .mockReturnValueOnce({ set: meetingSet });
    const { markTranscriptJobFailedSafely } = await import(
      "@/lib/transcript-job-failure"
    );

    await markTranscriptJobFailedSafely({
      errorMessage: "Chunked transcription failed",
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });

    const jobCondition = dialect.sqlToQuery(jobWhere.mock.calls[0][0]);
    const meetingCondition = dialect.sqlToQuery(
      meetingWhere.mock.calls[0][0],
    );
    expect(jobCondition.sql).toContain('"transcript_jobs"."status" <>');
    expect(jobCondition.params).toContain("completed");
    expect(meetingCondition.sql).toContain('"meetings"."status" =');
    expect(meetingCondition.params).toContain("processing");
    expect(meetingCondition.sql).toContain("not exists");
    expect(meetingCondition.sql).toContain("alive.status in");
  });

  it("does not touch the meeting when the job already completed", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    update.mockReturnValueOnce({ set });
    const { markTranscriptJobFailedSafely } = await import(
      "@/lib/transcript-job-failure"
    );

    await markTranscriptJobFailedSafely({
      errorMessage: "Late failure",
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });

    expect(update).toHaveBeenCalledOnce();
  });
});
