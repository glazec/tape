import { afterEach, describe, expect, it, vi } from "vitest";

const { deleteRows, execute, insert, select, update } = vi.hoisted(() => ({
  deleteRows: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    delete: deleteRows,
    execute,
    insert,
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
  recordElevenLabsTranscriptUsage: vi.fn(),
}));

describe("applyElevenLabsTranscriptEvent", () => {
  afterEach(() => {
    select.mockReset();
    deleteRows.mockReset();
    execute.mockReset();
    insert.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("marks the transcript job and meeting failed when ElevenLabs returns no transcript text", async () => {
    execute.mockResolvedValue({
      rows: [{ id: "22222222-2222-4222-8222-222222222222" }],
    });
    const limit = vi.fn().mockResolvedValue([
      {
        attendeeEmails: [],
        calendarMeetingUrl: null,
        meetingUrl: null,
        ownerEmail: null,
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
    const transcriptWhere = vi.fn().mockResolvedValue(undefined);
    const transcriptSet = vi.fn().mockReturnValue({ where: transcriptWhere });
    const meetingWhere = vi.fn().mockResolvedValue(undefined);
    const meetingSet = vi.fn().mockReturnValue({ where: meetingWhere });
    update
      .mockReturnValueOnce({ set: transcriptSet })
      .mockReturnValueOnce({ set: meetingSet });

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
    ).resolves.toMatchObject({ action: "fail" });

    expect(transcriptSet).toHaveBeenCalledWith({
      errorMessage: "No transcript text returned",
      providerJobId: "req_123",
      status: "failed",
      updatedAt: expect.any(Date),
    });
    expect(meetingSet).toHaveBeenCalledWith({
      status: "failed",
      updatedAt: expect.any(Date),
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

  it("persists transcript segments before marking the job completed", async () => {
    const operations: string[] = [];
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
    deleteRows.mockReturnValue({
      where: vi.fn().mockImplementation(async () => {
        operations.push("delete");
      }),
    });
    insert.mockReturnValue({
      values: vi.fn().mockImplementation(() => ({
        returning: vi.fn().mockImplementation(async () => {
          operations.push("insert");
          return [{ id: "55555555-5555-4555-8555-555555555555" }];
        }),
      })),
    });
    update.mockReturnValue({
      set: vi.fn().mockImplementation((values: { status?: string }) => ({
        where: vi.fn().mockImplementation(async () => {
          operations.push(
            values.status === "completed" ? "complete-job" : "update-meeting",
          );
        }),
      })),
    });
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

    expect(operations.indexOf("insert")).toBeGreaterThanOrEqual(0);
    expect(operations.indexOf("complete-job")).toBeGreaterThan(
      operations.indexOf("insert"),
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
