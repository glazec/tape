import { afterEach, describe, expect, it, vi } from "vitest";

const {
  databaseSql,
  execute,
  inngestSend,
  recordElevenLabsTranscriptUsage,
  select,
  transaction,
  txn,
  update,
} = vi.hoisted(() => ({
  databaseSql: vi.fn(),
  execute: vi.fn(),
  inngestSend: vi.fn(),
  recordElevenLabsTranscriptUsage: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
  txn: vi.fn((strings: TemplateStringsArray) => strings),
  update: vi.fn(),
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: inngestSend },
}));

vi.mock("@/db/client", () => ({
  databaseSql: Object.assign(databaseSql, { transaction }),
  db: {
    execute,
    select,
    update,
  },
}));

vi.mock("@/lib/meeting-participant-timeline", () => ({
  listMeetingParticipantTimeline: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/vendors/twenty", () => ({
  getTwentyCrmCompanyDomains: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/provider-usage", () => ({
  recordElevenLabsTranscriptUsage,
}));

describe("applyElevenLabsTranscriptEvent", () => {
  afterEach(() => {
    select.mockReset();
    execute.mockReset();
    inngestSend.mockReset();
    databaseSql.mockReset();
    recordElevenLabsTranscriptUsage.mockReset();
    transaction.mockReset();
    txn.mockClear();
    update.mockReset();
    vi.resetModules();
  });

  it("queues chunked recovery when ElevenLabs returns no transcript text", async () => {
    execute.mockResolvedValue({
      rows: [{ id: "22222222-2222-4222-8222-222222222222" }],
    });
    const limit = vi.fn().mockResolvedValue([
      {
        attendeeEmails: [],
        calendarMeetingUrl: null,
        meetingUrl: null,
        ownerEmail: null,
        teamId: "33333333-3333-4333-8333-333333333333",
      },
    ]);
    select.mockReturnValue({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({ limit }),
          }),
        }),
      }),
    });
    const transcriptReturning = vi
      .fn()
      .mockResolvedValue([{ id: "22222222-2222-4222-8222-222222222222" }]);
    const transcriptWhere = vi
      .fn()
      .mockReturnValue({ returning: transcriptReturning });
    const transcriptSet = vi.fn().mockReturnValue({ where: transcriptWhere });
    const meetingWhere = vi.fn().mockResolvedValue(undefined);
    const meetingSet = vi.fn().mockReturnValue({ where: meetingWhere });
    update
      .mockReturnValueOnce({ set: transcriptSet })
      .mockReturnValueOnce({ set: meetingSet });
    inngestSend.mockResolvedValue({ ids: ["recovery"] });

    const { applyElevenLabsTranscriptEvent } =
      await import("@/lib/elevenlabs-transcripts");

    await expect(
      applyElevenLabsTranscriptEvent({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptId: null,
        status: "completed",
        transcriptionText: "",
        transcriptionWords: [],
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).resolves.toEqual({
      action: "recover",
      recovery: "chunked",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });

    expect(inngestSend).toHaveBeenCalledWith({
      id: "empty-transcript-recovery:22222222-2222-4222-8222-222222222222",
      name: "meeting/recover.empty-transcript",
      data: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      },
    });

    expect(transcriptSet).toHaveBeenCalledWith({
      errorMessage:
        "Direct transcription returned no text; chunked recovery queued",
      providerJobId: "req_123",
      status: "running",
      updatedAt: expect.any(Date),
    });
    expect(meetingSet).toHaveBeenCalledWith({
      status: "processing",
      updatedAt: expect.any(Date),
    });
    expect(databaseSql).not.toHaveBeenCalled();
    expect(recordElevenLabsTranscriptUsage).toHaveBeenCalledWith({
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("ignores a delayed event for a superseded transcript job", async () => {
    execute.mockResolvedValue({
      rows: [{ id: "33333333-3333-4333-8333-333333333333" }],
    });
    const { applyElevenLabsTranscriptEvent } =
      await import("@/lib/elevenlabs-transcripts");

    await expect(
      applyElevenLabsTranscriptEvent({
        eventType: "speech_to_text_transcription",
        type: "speech_to_text_transcription",
        requestId: "req_old",
        transcriptId: null,
        status: "completed",
        transcriptionText: "Old transcript",
        transcriptionWords: [],
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).resolves.toEqual({
      action: "skip",
      reason: "superseded_transcript_job",
    });
    expect(select).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("atomically replaces transcript segments before completing the job", async () => {
    execute
      .mockResolvedValueOnce({
        rows: [
          {
            current_mode: "append",
            current_status: "running",
            id: "22222222-2222-4222-8222-222222222222",
            recording_id: "44444444-4444-4444-8444-444444444444",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            current_job_id: "22222222-2222-4222-8222-222222222222",
            first_recording_started_at: "2026-07-22T17:00:00.000Z",
            mode: "append",
            recording_started_at: "2026-07-22T17:20:00.000Z",
          },
        ],
      });
    select
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: () => ({
                limit: vi.fn().mockResolvedValue([
                  {
                    attendeeEmails: [],
                    calendarMeetingUrl: null,
                    meetingUrl: null,
                    ownerEmail: null,
                    teamId: "33333333-3333-4333-8333-333333333333",
                  },
                ]),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
    transaction.mockImplementation(async (buildQueries) => buildQueries(txn));
    const { applyElevenLabsTranscriptEvent } =
      await import("@/lib/elevenlabs-transcripts");

    await applyElevenLabsTranscriptEvent({
      eventType: "speech_to_text_transcription",
      type: "speech_to_text_transcription",
      requestId: "req_part_2",
      transcriptId: null,
      status: "completed",
      transcriptionText: "Part two",
      transcriptionWords: [],
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        recordingId: "44444444-4444-4444-8444-444444444444",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      },
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(txn).toHaveBeenCalledTimes(6);
    expect(txn.mock.calls[1]?.[0].join(" ")).toContain(
      "delete from transcript_segments",
    );
    expect(txn.mock.calls[2]?.[0].join(" ")).toContain(
      "insert into transcript_segments",
    );
    expect(txn.mock.calls[5]?.[0].join(" ")).toContain(
      "update transcript_jobs",
    );
    expect(txn.mock.calls[5]?.[0].join(" ")).toContain(
      "error_message = null",
    );
  });
});

describe("getTranscriptSegmentOffsetMs", () => {
  it("places a resumed transcript at its recording start within the meeting", async () => {
    const { getTranscriptSegmentOffsetMs } =
      await import("@/lib/elevenlabs-transcripts");

    expect(
      getTranscriptSegmentOffsetMs({
        firstRecordingStartedAt: "2026-07-22T17:00:58.000Z",
        mode: "append",
        recordingStartedAt: "2026-07-22T17:20:58.000Z",
      }),
    ).toBe(1_200_000);
  });

  it("uses cumulative duration and falls back when a prior duration is unknown", async () => {
    const { getTranscriptSegmentOffsetMs } =
      await import("@/lib/elevenlabs-transcripts");
    const context = {
      firstRecordingStartedAt: "2026-07-22T17:00:58.000Z",
      mode: "append" as const,
      recordingStartedAt: "2026-07-22T17:20:58.000Z",
    };

    expect(
      getTranscriptSegmentOffsetMs({ ...context, recordingOffsetMs: 385_000 }),
    ).toBe(385_000);
    expect(
      getTranscriptSegmentOffsetMs({ ...context, recordingOffsetMs: null }),
    ).toBe(1_200_000);
  });
});

describe("finalizeMeetingTranscriptGeneration", () => {
  it("allows only the callback that observes every terminal job to finalize", async () => {
    databaseSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: "ready" }]);
    const { finalizeMeetingTranscriptGeneration } =
      await import("@/lib/elevenlabs-transcripts");

    await expect(
      Promise.all([
        finalizeMeetingTranscriptGeneration(
          "11111111-1111-4111-8111-111111111111",
          new Date(),
        ),
        finalizeMeetingTranscriptGeneration(
          "11111111-1111-4111-8111-111111111111",
          new Date(),
        ),
      ]),
    ).resolves.toEqual([false, true]);
  });

  it("does not report a failed generation as ready for enrichment", async () => {
    databaseSql.mockResolvedValueOnce([{ status: "failed" }]);
    const { finalizeMeetingTranscriptGeneration } =
      await import("@/lib/elevenlabs-transcripts");

    await expect(
      finalizeMeetingTranscriptGeneration(
        "11111111-1111-4111-8111-111111111111",
        new Date(),
      ),
    ).resolves.toBe(false);
  });
});

describe("isTranscriptJobApplicable", () => {
  it("accepts an older recording transcript after a resumed append job exists", async () => {
    const { isTranscriptJobApplicable } =
      await import("@/lib/elevenlabs-transcripts");

    expect(
      isTranscriptJobApplicable(
        {
          current_mode: "replace",
          current_status: "running",
          id: "33333333-3333-4333-8333-333333333333",
          recording_id: "44444444-4444-4444-8444-444444444444",
        },
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBe(true);
  });
});
