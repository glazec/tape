import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const getWorkspace = vi.fn();
const assertCanCreateMeetings = vi.fn();
const putObject = vi.fn();
const createUploadedAudioTranscription = vi.fn();
const createUploadedVideoTranscription = vi.fn();
const revalidatePath = vi.fn();
const send = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    putObject,
  };
});

vi.mock("@/inngest/client", () => ({
  inngest: {
    send,
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath,
}));

vi.mock("@/lib/transcription-records", () => ({
  createUploadedAudioTranscription,
  createUploadedVideoTranscription,
}));

async function postAudioUpload(
  file: File,
  fields: { startedAt?: string } = {},
) {
  const { POST } = await import("@/app/api/uploads/audio/route");
  const formData = new FormData();
  formData.set("meeting-audio", file);
  if (fields.startedAt) {
    formData.set("startedAt", fields.startedAt);
  }

  return POST(
    new Request("https://app.example.com/api/uploads/audio", {
      method: "POST",
      body: formData,
    }),
  );
}

describe("POST /api/uploads/audio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    assertCanCreateMeetings.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    putObject.mockReset();
    createUploadedAudioTranscription.mockReset();
    createUploadedVideoTranscription.mockReset();
    revalidatePath.mockReset();
    send.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await postAudioUpload(
      new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(putObject).not.toHaveBeenCalled();
  });

  it("queues transcription after storing the authenticated user's MP3", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    putObject.mockResolvedValue(undefined);
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });
    send.mockResolvedValue({ ids: ["evt_123"] });

    const response = await postAudioUpload(
      new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      meetingId: "22222222-2222-4222-8222-222222222222",
      redirectTo: "/dashboard",
    });
    expect(putObject).toHaveBeenCalledWith({
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      body: expect.any(Uint8Array),
      contentType: "audio/mpeg",
    });
    expect(createUploadedAudioTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      title: "sample",
      fileSizeBytes: 8,
      mimeType: "audio/mpeg",
    });
    expect(send).toHaveBeenCalledWith({
      name: "meeting/transcribe.audio",
      data: {
        meetingId: "22222222-2222-4222-8222-222222222222",
        mediaAssetId: "33333333-3333-4333-8333-333333333333",
        objectKey:
          "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
        transcriptJobId: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("uses the supplied meeting start time for fallback MP3 uploads", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    putObject.mockResolvedValue(undefined);
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });
    send.mockResolvedValue({ ids: ["evt_123"] });

    const response = await postAudioUpload(
      new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
      { startedAt: "2026-06-27T15:30:00.000Z" },
    );

    expect(response.status).toBe(202);
    expect(createUploadedAudioTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      title: "sample",
      startedAt: new Date("2026-06-27T15:30:00.000Z"),
      fileSizeBytes: 8,
      mimeType: "audio/mpeg",
    });
  });

  it("queues transcription after storing a fallback M4A upload", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "66666666-6666-4666-8666-666666666666",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    putObject.mockResolvedValue(undefined);
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });
    send.mockResolvedValue({ ids: ["evt_123"] });

    const response = await postAudioUpload(
      new File(["fake m4a"], "partner sync.m4a", { type: "audio/mp4" }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: "users/user_123/uploads/66666666-6666-4666-8666-666666666666.m4a",
      meetingId: "22222222-2222-4222-8222-222222222222",
      redirectTo: "/dashboard",
    });
    expect(putObject).toHaveBeenCalledWith({
      key: "users/user_123/uploads/66666666-6666-4666-8666-666666666666.m4a",
      body: expect.any(Uint8Array),
      contentType: "audio/mp4",
    });
    expect(createUploadedAudioTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/66666666-6666-4666-8666-666666666666.m4a",
      title: "partner sync",
      fileSizeBytes: 8,
      mimeType: "audio/mp4",
    });
  });

  it("rejects invalid fallback upload start times", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await postAudioUpload(
      new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
      { startedAt: "not a date" },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid audio upload request",
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(createUploadedAudioTranscription).not.toHaveBeenCalled();
  });

  it("queues video conversion before transcription for fallback MP4 uploads", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
    putObject.mockResolvedValue(undefined);
    createUploadedVideoTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      sourceMediaAssetId: "33333333-3333-4333-8333-333333333333",
      audioMediaAssetId: "44444444-4444-4444-8444-444444444444",
      transcriptJobId: "55555555-5555-4555-8555-555555555555",
      audioObjectKey:
        "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
    });
    send.mockResolvedValue({ ids: ["evt_456"] });

    const response = await postAudioUpload(
      new File(["fake mp4"], "sample.mp4", { type: "video/mp4" }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp4",
      meetingId: "22222222-2222-4222-8222-222222222222",
      redirectTo: "/dashboard",
    });
    expect(putObject).toHaveBeenCalledWith({
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp4",
      body: expect.any(Uint8Array),
      contentType: "video/mp4",
    });
    expect(createUploadedAudioTranscription).not.toHaveBeenCalled();
    expect(createUploadedVideoTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp4",
      title: "sample",
      fileSizeBytes: 8,
      mimeType: "video/mp4",
    });
    expect(send).toHaveBeenCalledWith({
      name: "meeting/convert.video-to-audio",
      data: {
        meetingId: "22222222-2222-4222-8222-222222222222",
        sourceMediaAssetId: "33333333-3333-4333-8333-333333333333",
        sourceObjectKey:
          "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp4",
        audioMediaAssetId: "44444444-4444-4444-8444-444444444444",
        audioObjectKey:
          "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
        transcriptJobId: "55555555-5555-4555-8555-555555555555",
      },
    });
  });

  it("rejects unsupported audio files", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await postAudioUpload(
      new File(["fake wav"], "sample.wav", { type: "audio/wav" }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid audio upload request",
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(createUploadedAudioTranscription).not.toHaveBeenCalled();
    expect(createUploadedVideoTranscription).not.toHaveBeenCalled();
  });

  it("rejects shared only users before storing fallback MP3 uploads", async () => {
    const { SharedOnlyAccessError } = await import("@/lib/access-errors");

    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "reader@partner.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "partner.com",
      canCreateMeetings: false,
    });
    assertCanCreateMeetings.mockRejectedValue(new SharedOnlyAccessError());

    const response = await postAudioUpload(
      new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Shared users cannot add meetings",
    });
    expect(putObject).not.toHaveBeenCalled();
    expect(createUploadedAudioTranscription).not.toHaveBeenCalled();
    expect(createUploadedVideoTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
