import { afterEach, describe, expect, it, vi } from "vitest";

import { parseManualTranscriptText } from "@/lib/manual-transcript-parser";

const {
  insert,
  limit,
  returning,
  set,
  syncMeetingParticipantAccessFromCalendar,
  transaction,
  txn,
  values,
  where,
} = vi.hoisted(() => ({
  insert: vi.fn(),
  limit: vi.fn(),
  returning: vi.fn(),
  set: vi.fn(),
  syncMeetingParticipantAccessFromCalendar: vi.fn(),
  transaction: vi.fn(),
  txn: vi.fn((strings: TemplateStringsArray) => strings),
  values: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  databaseSql: { transaction },
  db: {
    delete: () => ({ where }),
    insert,
    select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
    update: () => ({ set }),
  },
}));

vi.mock("@/lib/meeting-write-policy", () => ({
  getManageableMeetingCondition: vi.fn(() => "manageable"),
}));

vi.mock("@/lib/meeting-participant-access", () => ({
  syncMeetingParticipantAccessFromCalendar,
}));

vi.mock("@/lib/r2", () => ({
  parseR2Env: vi.fn(() => ({ R2_BUCKET: "meeting-audio" })),
}));

const workspace = {
  canCreateMeetings: true,
  domain: "example.com",
  teamId: "team_123",
  userId: "user_123",
};

describe("parseManualTranscriptText", () => {
  it("defaults transcript text without speaker names to Speaker 1", () => {
    expect(parseManualTranscriptText("This transcript has no speaker label.")).toEqual([
      {
        speaker: "Speaker 1",
        startMs: 0,
        text: "This transcript has no speaker label.",
      },
    ]);
  });

  it("keeps speaker labels when they are present", () => {
    expect(parseManualTranscriptText("Alice: Hello\n\nBob: Thanks")).toEqual([
      {
        speaker: "Alice",
        startMs: 0,
        text: "Hello",
      },
      {
        speaker: "Bob",
        startMs: 0,
        text: "Thanks",
      },
    ]);
  });

  it("preserves real SRT cue timing", () => {
    expect(
      parseManualTranscriptText(
        "1\n00:00:03,250 --> 00:00:05,750\nAlice: Hello\n\n2\n00:44:58,000 --> 00:45:00,000\nBob: Thanks",
      ),
    ).toEqual([
      {
        endMs: 5750,
        speaker: "Alice",
        startMs: 3250,
        text: "Hello",
      },
      {
        endMs: 45 * 60 * 1000,
        speaker: "Bob",
        startMs: 44 * 60 * 1000 + 58_000,
        text: "Thanks",
      },
    ]);
  });

  it("preserves VTT cues without creating a WEBVTT transcript line", () => {
    expect(
      parseManualTranscriptText(
        "WEBVTT\n\n00:03.250 --> 00:05.750 align:start\nAlice: Hello",
      ),
    ).toEqual([
      {
        endMs: 5750,
        speaker: "Alice",
        startMs: 3250,
        text: "Hello",
      },
    ]);
  });
});

describe("meeting recovery uploads", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("creates an audio asset and queued transcript job", async () => {
    limit.mockResolvedValue([{ id: "meeting_123" }]);
    values.mockReturnValue({ returning });
    insert.mockReturnValue({ values });
    returning
      .mockResolvedValueOnce([{ id: "recording_123" }])
      .mockResolvedValueOnce([{ id: "asset_123" }])
      .mockResolvedValueOnce([{ id: "job_123" }]);
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
    const { completeMeetingAudioUpload } = await import(
      "@/lib/meeting-recovery-uploads"
    );

    await expect(
      completeMeetingAudioUpload({
        fileSizeBytes: 1234,
        durationMs: 45 * 60 * 1000,
        meetingId: "meeting_123",
        mimeType: "audio/mp4",
        objectKey: "uploads/recovery.m4a",
        workspace,
      }),
    ).resolves.toEqual({
      mediaAssetId: "asset_123",
      meetingId: "meeting_123",
      objectKey: "uploads/recovery.m4a",
      recordingId: "recording_123",
      transcriptJobId: "job_123",
    });
    expect(values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        durationMs: 45 * 60 * 1000,
        meetingId: "meeting_123",
        source: "upload",
      }),
    );
    expect(values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        bucket: "meeting-audio",
        meetingId: "meeting_123",
        recordingId: "recording_123",
        type: "audio",
      }),
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    );
    expect(values).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        mode: "replace",
        recordingId: "recording_123",
      }),
    );
    expect(syncMeetingParticipantAccessFromCalendar).not.toHaveBeenCalled();
    expect(where).toHaveBeenCalled();
  });

  it("replaces transcript segments and marks a manual recovery ready", async () => {
    limit.mockResolvedValue([{ id: "meeting_123" }]);
    transaction.mockImplementation(async (buildQueries) => buildQueries(txn));
    const { completeManualTranscriptUpload } = await import(
      "@/lib/meeting-recovery-uploads"
    );

    await expect(
      completeManualTranscriptUpload({
        meetingId: "meeting_123",
        transcriptText: "Alice: Hello\n\nBob: Hi",
        workspace,
      }),
    ).resolves.toEqual({
      meetingId: "meeting_123",
      segmentCount: 2,
      transcriptJobId: expect.any(String),
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(txn).toHaveBeenCalledTimes(5);
    expect(txn.mock.calls[2]?.[0].join(" ")).toContain(
      "delete from transcript_segments",
    );
    expect(txn.mock.calls[3]?.[0].join(" ")).toContain(
      "insert into transcript_segments",
    );
    expect(txn.mock.calls[4]?.[0].join(" ")).toContain("status = 'ready'");
    expect(syncMeetingParticipantAccessFromCalendar).not.toHaveBeenCalled();
  });

  it("rejects recovery when the meeting is outside the write boundary", async () => {
    limit.mockResolvedValue([]);
    const { completeMeetingAudioUpload, MeetingRecoveryUploadError } =
      await import("@/lib/meeting-recovery-uploads");

    await expect(
      completeMeetingAudioUpload({
        meetingId: "meeting_123",
        objectKey: "uploads/recovery.mp3",
        workspace,
      }),
    ).rejects.toBeInstanceOf(MeetingRecoveryUploadError);
    expect(insert).not.toHaveBeenCalled();
  });
});
