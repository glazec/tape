import { afterEach, describe, expect, it, vi } from "vitest";

const getCurrentUser = vi.fn();
const getWorkspace = vi.fn();
const assertCanCreateMeetings = vi.fn();
const getObjectMetadata = vi.fn();
const createUploadedAudioTranscription = vi.fn();
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
    expect(send).not.toHaveBeenCalled();
  });
});
