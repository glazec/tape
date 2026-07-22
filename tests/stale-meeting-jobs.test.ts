import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute },
}));

describe("reconcileStaleMeetingJobs", () => {
  afterEach(() => {
    execute.mockReset();
    vi.resetModules();
  });

  it("fails stale transcript and translation work in one database operation", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          failed_processing_count: 4,
          failed_recording_count: 3,
          failed_transcript_job_count: 2,
          failed_translation_count: 1,
        },
      ],
    });

    const { reconcileStaleMeetingJobs } = await import(
      "@/lib/stale-meeting-jobs"
    );

    await expect(
      reconcileStaleMeetingJobs({
        now: new Date("2026-07-11T18:00:00.000Z"),
      }),
    ).resolves.toEqual({
      failedProcessingCount: 4,
      failedRecordingCount: 3,
      failedTranscriptJobCount: 2,
      failedTranslationCount: 1,
    });
    expect(execute).toHaveBeenCalledTimes(1);

    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
    expect(query).not.toContain("select latest.status");
    expect(query).toContain("from stale_transcript_jobs");
    // Stale jobs are failed unconditionally (no newer-sibling exemption), so
    // zombies never block re-transcription; the meeting is only failed when no
    // live job remains.
    expect(query).not.toContain("as newer");
    expect(query).toContain("from transcript_jobs as alive");
    expect(query).toContain("meeting.updated_at <");
    expect(query).toContain("from transcript_jobs as any_job");
    expect(query).toContain("meeting.recall_bot_id is not null");
    expect(query).toContain("meeting.recall_recording_id is not null");
    // The recording sweep keys off device liveness, not meetings.updated_at.
    expect(query).toContain("meeting.status = 'recording'");
    expect(query).toContain("local_recorder_devices");
  });
});
