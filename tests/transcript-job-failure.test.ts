import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const { databaseSql, update } = vi.hoisted(() => ({
  databaseSql: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  databaseSql,
  db: { update },
}));

const dialect = new PgDialect();

describe("safe transcript job failure", () => {
  afterEach(() => {
    databaseSql.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("fails only the matching unfinished job and uses aggregate finalization", async () => {
    const jobReturning = vi.fn().mockResolvedValue([{ id: "job_123" }]);
    const jobWhere = vi.fn((condition: SQL) => {
      void condition;
      return { returning: jobReturning };
    });
    const jobSet = vi.fn(() => ({ where: jobWhere }));
    update.mockReturnValueOnce({ set: jobSet });
    databaseSql.mockResolvedValue([{ status: "failed" }]);
    const { markTranscriptJobFailedSafely } = await import(
      "@/lib/transcript-job-failure"
    );

    await expect(
      markTranscriptJobFailedSafely({
        errorMessage: "Chunked transcription failed",
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toEqual({ jobUpdated: true, meetingFinalized: false });

    const jobCondition = dialect.sqlToQuery(jobWhere.mock.calls[0][0]);
    expect(jobCondition.sql).toContain('"transcript_jobs"."meeting_id" =');
    expect(jobCondition.sql).toContain('"transcript_jobs"."status" <>');
    expect(jobCondition.params).toContain("completed");
    expect(databaseSql).toHaveBeenCalledOnce();
    expect(databaseSql.mock.calls[0]?.[0]?.join(" ")).toContain(
      "active_generation",
    );
  });

  it("does not finalize after a late failure for a completed job", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    update.mockReturnValueOnce({ set });
    const { markTranscriptJobFailedSafely } = await import(
      "@/lib/transcript-job-failure"
    );

    await expect(
      markTranscriptJobFailedSafely({
        errorMessage: "Late failure",
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toEqual({ jobUpdated: false, meetingFinalized: false });
    expect(databaseSql).not.toHaveBeenCalled();
  });
});
