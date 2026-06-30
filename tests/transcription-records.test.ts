import { afterEach, describe, expect, it, vi } from "vitest";

const getOrCreateWorkspaceForSessionUser = vi.fn();
const assertCanCreateMeetings = vi.fn();
const insert = vi.fn();
const values = vi.fn();
const meetingReturning = vi.fn();
const assetReturning = vi.fn();
const jobReturning = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    insert,
  },
}));

vi.mock("@/lib/r2", () => ({
  parseR2Env: () => ({ R2_BUCKET: "meeting-audio" }),
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
}));

describe("createUploadedAudioTranscription", () => {
  afterEach(() => {
    assertCanCreateMeetings.mockReset();
    getOrCreateWorkspaceForSessionUser.mockReset();
    insert.mockReset();
    values.mockReset();
    meetingReturning.mockReset();
    assetReturning.mockReset();
    jobReturning.mockReset();
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
    jobReturning.mockResolvedValue([
      { id: "55555555-5555-4555-8555-555555555555" },
    ]);
    values
      .mockReturnValueOnce({ returning: meetingReturning })
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
        fileSizeBytes: 1024,
        mimeType: "audio/mpeg",
      }),
    ).resolves.toEqual({
      meetingId: "33333333-3333-4333-8333-333333333333",
      mediaAssetId: "44444444-4444-4444-8444-444444444444",
      transcriptJobId: "55555555-5555-4555-8555-555555555555",
    });
    expect(values).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ startedAt }),
    );
  });
});
