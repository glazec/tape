import { afterEach, describe, expect, it, vi } from "vitest";

const getOrCreateWorkspaceForSessionUser = vi.fn();
const assertCanCreateMeetings = vi.fn();
const insert = vi.fn();
const values = vi.fn();
const meetingReturning = vi.fn();
const recordingReturning = vi.fn();
const assetReturning = vi.fn();
const jobReturning = vi.fn();
const update = vi.fn();
const reconcileMeetingSharingForMeeting = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    insert,
    update,
  },
}));

vi.mock("@/lib/r2", () => ({
  buildMeetingObjectKey: ({
    assetId,
    meetingId,
    teamId,
    extension,
  }: {
    assetId: string;
    meetingId: string;
    teamId: string;
    extension: string;
  }) => `teams/${teamId}/meetings/${meetingId}/assets/${assetId}.${extension}`,
  getObjectMetadata: vi.fn(),
  parseR2Env: () => ({ R2_BUCKET: "meeting-audio" }),
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
}));

vi.mock("@/lib/meeting-share-rules", () => ({
  reconcileMeetingSharingForMeeting,
}));

describe("createUploadedAudioTranscription", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    getOrCreateWorkspaceForSessionUser.mockReset();
    insert.mockReset();
    values.mockReset();
    meetingReturning.mockReset();
    recordingReturning.mockReset();
    assetReturning.mockReset();
    jobReturning.mockReset();
    update.mockReset();
    reconcileMeetingSharingForMeeting.mockReset();
    vi.resetModules();
  });

  it("uses a supplied upload start time for the meeting record", async () => {
    getOrCreateWorkspaceForSessionUser.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    meetingReturning.mockResolvedValue([
      { id: "33333333-3333-4333-8333-333333333333" },
    ]);
    assetReturning.mockResolvedValue([
      { id: "44444444-4444-4444-8444-444444444444" },
    ]);
    recordingReturning.mockResolvedValue([
      { id: "77777777-7777-4777-8777-777777777777" },
    ]);
    jobReturning.mockResolvedValue([
      { id: "55555555-5555-4555-8555-555555555555" },
    ]);
    values
      .mockReturnValueOnce({ returning: meetingReturning })
      .mockReturnValueOnce({ returning: recordingReturning })
      .mockReturnValueOnce({ returning: assetReturning })
      .mockReturnValueOnce({ returning: jobReturning });
    insert.mockReturnValue({ values });
    const startedAt = new Date("2026-06-27T15:30:00.000Z");

    const { createUploadedAudioTranscription } = await import(
      "@/lib/transcription-records"
    );

    await expect(
      createUploadedAudioTranscription({
        sessionUser: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "user@example.com",
          name: null,
        },
        objectKey: "users/user_123/uploads/upload.mp3",
        title: "Customer call",
        startedAt,
        durationMs: 45 * 60 * 1000,
        fileSizeBytes: 1024,
        mimeType: "audio/mpeg",
      }),
    ).resolves.toEqual({
      meetingId: "33333333-3333-4333-8333-333333333333",
      mediaAssetId: "44444444-4444-4444-8444-444444444444",
      recordingId: "77777777-7777-4777-8777-777777777777",
      transcriptJobId: "55555555-5555-4555-8555-555555555555",
    });
    expect(reconcileMeetingSharingForMeeting).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ startedAt }),
    );
    expect(values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        durationMs: 45 * 60 * 1000,
        source: "upload",
      }),
    );
  });
});

describe("createUploadedVideoTranscription", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    getOrCreateWorkspaceForSessionUser.mockReset();
    insert.mockReset();
    values.mockReset();
    meetingReturning.mockReset();
    recordingReturning.mockReset();
    assetReturning.mockReset();
    jobReturning.mockReset();
    update.mockReset();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("creates a source asset and queued job before conversion", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "66666666-6666-4666-8666-666666666666",
    );
    getOrCreateWorkspaceForSessionUser.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      teamId: "22222222-2222-4222-8222-222222222222",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    meetingReturning.mockResolvedValue([
      { id: "33333333-3333-4333-8333-333333333333" },
    ]);
    assetReturning.mockResolvedValue([
      { id: "44444444-4444-4444-8444-444444444444" },
    ]);
    recordingReturning.mockResolvedValue([
      { id: "77777777-7777-4777-8777-777777777777" },
    ]);
    jobReturning.mockResolvedValue([
      { id: "55555555-5555-4555-8555-555555555555" },
    ]);
    values
      .mockReturnValueOnce({ returning: meetingReturning })
      .mockReturnValueOnce({ returning: recordingReturning })
      .mockReturnValueOnce({ returning: assetReturning })
      .mockReturnValueOnce({ returning: jobReturning });
    insert.mockReturnValue({ values });

    const { createUploadedVideoTranscription } = await import(
      "@/lib/transcription-records"
    );

    await expect(
      createUploadedVideoTranscription({
        sessionUser: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "user@example.com",
          name: null,
        },
        objectKey: "users/user_123/uploads/upload.mp4",
        title: "Customer call",
        fileSizeBytes: 4096,
        mimeType: "video/mp4",
      }),
    ).resolves.toEqual({
      meetingId: "33333333-3333-4333-8333-333333333333",
      sourceMediaAssetId: "44444444-4444-4444-8444-444444444444",
      audioMediaAssetId: "66666666-6666-4666-8666-666666666666",
      recordingId: "77777777-7777-4777-8777-777777777777",
      transcriptJobId: "55555555-5555-4555-8555-555555555555",
      audioObjectKey:
        "teams/22222222-2222-4222-8222-222222222222/meetings/33333333-3333-4333-8333-333333333333/assets/66666666-6666-4666-8666-666666666666.mp3",
    });
    expect(values).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        objectKey: "users/user_123/uploads/upload.mp4",
        type: "transcript_source",
      }),
    );
    expect(values).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        mediaAssetId: null,
        status: "queued",
      }),
    );
  });
});
