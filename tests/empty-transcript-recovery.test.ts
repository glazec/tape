import { describe, expect, it, vi } from "vitest";

const {
  execute,
  getMeetingVocabularyKeyterms,
  markTranscriptJobFailedSafely,
  update,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  getMeetingVocabularyKeyterms: vi.fn(),
  markTranscriptJobFailedSafely: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute, update },
}));
vi.mock("@/lib/team-vocabulary", () => ({
  getMeetingVocabularyKeyterms,
}));
vi.mock("@/lib/transcript-job-failure", () => ({
  markTranscriptJobFailedSafely,
}));

import {
  buildEmptyTranscriptRecoveryEvent,
  prepareEmptyTranscriptRecovery,
  shouldRecoverEmptyTranscript,
} from "@/lib/empty-transcript-recovery";

describe("empty transcript recovery", () => {
  it("builds one deterministic recovery event per transcript job", () => {
    expect(
      buildEmptyTranscriptRecoveryEvent({
        meetingId: "11111111-1111-4111-8111-111111111111",
        objectKey: "teams/team/meeting/audio.mp3",
        recordingId: "33333333-3333-4333-8333-333333333333",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual({
      id: "empty-transcript-recovery:22222222-2222-4222-8222-222222222222",
      name: "meeting/recover.empty-transcript",
      data: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        objectKey: "teams/team/meeting/audio.mp3",
        recordingId: "33333333-3333-4333-8333-333333333333",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      },
    });
  });

  it("does not recursively recover chunked transcript results", () => {
    expect(
      shouldRecoverEmptyTranscript({
        errorMessage: "No transcript text returned",
        providerJobId: "request_123",
      }),
    ).toBe(true);
    expect(
      shouldRecoverEmptyTranscript({
        errorMessage: "No transcript text returned",
        providerJobId: "chunks:chunk_1+chunk_2",
      }),
    ).toBe(false);
    expect(
      shouldRecoverEmptyTranscript({
        errorMessage: "No transcript text returned",
        providerJobId: "split:chunk_1+chunk_2",
      }),
    ).toBe(false);
  });

  it("resolves stable Recall identifiers and marks the job recoverable", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          asset_object_key: null,
          external_bot_id: "recall_bot_123",
          external_recording_id: "recall_recording_123",
          meeting_bot_id: null,
          meeting_recording_id: null,
          recording_id: "33333333-3333-4333-8333-333333333333",
        },
      ],
    });
    getMeetingVocabularyKeyterms.mockResolvedValue(["IOSG"]);
    const transcriptWhere = vi.fn().mockResolvedValue(undefined);
    const transcriptSet = vi.fn(() => ({ where: transcriptWhere }));
    const meetingWhere = vi.fn().mockResolvedValue(undefined);
    const meetingSet = vi.fn(() => ({ where: meetingWhere }));
    update
      .mockReturnValueOnce({ set: transcriptSet })
      .mockReturnValueOnce({ set: meetingSet });

    await expect(
      prepareEmptyTranscriptRecovery({
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toEqual({
      keyterms: ["IOSG"],
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "recall_bot_123",
      recallRecordingId: "recall_recording_123",
      recordingId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });
    expect(transcriptSet).toHaveBeenCalledWith({
      errorMessage:
        "Direct transcription returned no text; chunked recovery queued",
      status: "running",
      updatedAt: expect.any(Date),
    });
    expect(meetingSet).toHaveBeenCalledWith({
      status: "processing",
      updatedAt: expect.any(Date),
    });
  });
});
