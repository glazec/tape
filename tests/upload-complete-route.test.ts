import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const getWorkspace = vi.fn();
const assertCanCreateMeetings = vi.fn();
const getObjectMetadata = vi.fn();
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

vi.mock("@/inngest/client", () => ({
  inngest: {
    send,
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    getObjectMetadata,
  };
});

vi.mock("@/lib/transcription-records", () => ({
  createUploadedAudioTranscription,
  createUploadedVideoTranscription,
}));

async function postUploadComplete(body: unknown) {
  const { POST } = await import("@/app/api/uploads/complete/route");

  return POST(
    new Request("https://app.example.com/api/uploads/complete", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
  );
}

describe("POST /api/uploads/complete", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    assertCanCreateMeetings.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    getObjectMetadata.mockReset();
    createUploadedAudioTranscription.mockReset();
    createUploadedVideoTranscription.mockReset();
    revalidatePath.mockReset();
    send.mockReset();
    vi.resetModules();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(send).not.toHaveBeenCalled();
  });

  it("returns 400 for unsafe upload ids", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await postUploadComplete({ uploadId: "../upload" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid upload completion request",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("queues transcription for the authenticated user's uploaded MP3", async () => {
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
    send.mockResolvedValue({ ids: ["evt_123"] });
    getObjectMetadata.mockResolvedValue({
      contentLength: 1024,
      contentType: "audio/mpeg",
    });
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      meetingId: "22222222-2222-4222-8222-222222222222",
      redirectTo: "/dashboard",
    });
    expect(getObjectMetadata).toHaveBeenCalledWith({
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
    });
    expect(createUploadedAudioTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      fileSizeBytes: 1024,
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

  it("uses a cleaned filename as the uploaded meeting title", async () => {
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
    send.mockResolvedValue({ ids: ["evt_123"] });
    getObjectMetadata.mockResolvedValue({
      contentLength: 1024,
      contentType: "audio/mpeg",
    });
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
      fileName: "  IOSG_founder-follow up .mp3",
    });

    expect(response.status).toBe(202);
    expect(createUploadedAudioTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      title: "IOSG founder follow up",
      fileSizeBytes: 1024,
      mimeType: "audio/mpeg",
    });
  });

  it("uses the supplied meeting start time for uploaded audio", async () => {
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
    send.mockResolvedValue({ ids: ["evt_123"] });
    getObjectMetadata.mockResolvedValue({
      contentLength: 1024,
      contentType: "audio/mpeg",
    });
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
      startedAt: "2026-06-27T15:30:00.000Z",
    });

    expect(response.status).toBe(202);
    expect(createUploadedAudioTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp3",
      startedAt: new Date("2026-06-27T15:30:00.000Z"),
      fileSizeBytes: 1024,
      mimeType: "audio/mpeg",
    });
  });

  it("queues transcription for the authenticated user's uploaded M4A", async () => {
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
    send.mockResolvedValue({ ids: ["evt_123"] });
    getObjectMetadata.mockResolvedValue({
      contentLength: 2048,
      contentType: "audio/mp4",
    });
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
      extension: "m4a",
      contentType: "audio/mp4",
      fileName: "partner sync.m4a",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.m4a",
      meetingId: "22222222-2222-4222-8222-222222222222",
      redirectTo: "/dashboard",
    });
    expect(createUploadedAudioTranscription).toHaveBeenCalledWith({
      sessionUser: {
        id: "user_123",
        email: "user@example.com",
        name: null,
      },
      objectKey:
        "users/user_123/uploads/11111111-1111-4111-8111-111111111111.m4a",
      title: "partner sync",
      fileSizeBytes: 2048,
      mimeType: "audio/mp4",
    });
    expect(send).toHaveBeenCalledWith({
      name: "meeting/transcribe.audio",
      data: {
        meetingId: "22222222-2222-4222-8222-222222222222",
        mediaAssetId: "33333333-3333-4333-8333-333333333333",
        objectKey:
          "users/user_123/uploads/11111111-1111-4111-8111-111111111111.m4a",
        transcriptJobId: "44444444-4444-4444-8444-444444444444",
      },
    });
  });

  it("queues video conversion before transcription for uploaded MP4 files", async () => {
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
    send.mockResolvedValue({ ids: ["evt_456"] });
    getObjectMetadata.mockResolvedValue({
      contentLength: 4096,
      contentType: "video/mp4",
    });
    createUploadedVideoTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      sourceMediaAssetId: "33333333-3333-4333-8333-333333333333",
      audioMediaAssetId: "44444444-4444-4444-8444-444444444444",
      transcriptJobId: "55555555-5555-4555-8555-555555555555",
      audioObjectKey:
        "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
    });

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
      extension: "mp4",
      contentType: "video/mp4",
      fileName: "founder call.mp4",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: "users/user_123/uploads/11111111-1111-4111-8111-111111111111.mp4",
      meetingId: "22222222-2222-4222-8222-222222222222",
      redirectTo: "/dashboard",
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
      title: "founder call",
      fileSizeBytes: 4096,
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

  it("rejects invalid meeting start times", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
      startedAt: "not a date",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid upload completion request",
    });
    expect(createUploadedAudioTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects shared only users before reading uploaded object metadata", async () => {
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

    const response = await postUploadComplete({
      uploadId: "11111111-1111-4111-8111-111111111111",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Shared users cannot add meetings",
    });
    expect(getObjectMetadata).not.toHaveBeenCalled();
    expect(createUploadedAudioTranscription).not.toHaveBeenCalled();
    expect(createUploadedVideoTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
