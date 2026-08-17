import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/provider-credit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-credit")>()),
  assertWorkspaceHasProviderCredit: vi.fn(),
}));
vi.mock("@/lib/request-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-rate-limit")>()),
  assertRequestRateLimit: vi.fn(),
}));

const getCurrentUser = vi.fn();
const getWorkspace = vi.fn();
const getObjectMetadata = vi.fn();
const deleteObject = vi.fn();
const putObject = vi.fn();
const assertCanManageMeeting = vi.fn();
const completeMeetingAudioUpload = vi.fn();
const completeManualTranscriptUpload = vi.fn();
const revalidatePath = vi.fn();
const send = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    deleteObject,
    getObjectMetadata,
    putObject,
  };
});

class MeetingRecoveryUploadError extends Error {}

vi.mock("@/lib/meeting-recovery-uploads", () => ({
  assertCanManageMeeting,
  completeManualTranscriptUpload,
  completeMeetingAudioUpload,
  MeetingRecoveryUploadError,
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send,
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath,
}));

async function postAudioComplete(body: unknown) {
  const { POST } = await import(
    "@/app/api/meetings/[meetingId]/uploads/audio/complete/route"
  );

  return POST(
    new Request(
      "https://app.example.com/api/meetings/meeting_123/uploads/audio/complete",
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
      },
    ),
    { params: Promise.resolve({ meetingId: "meeting_123" }) },
  );
}

async function postAudioUpload(formData: FormData) {
  const { POST } = await import(
    "@/app/api/meetings/[meetingId]/uploads/audio/route"
  );

  return POST(
    new Request(
      "https://app.example.com/api/meetings/meeting_123/uploads/audio",
      {
        method: "POST",
        body: formData,
      },
    ),
    { params: Promise.resolve({ meetingId: "meeting_123" }) },
  );
}

async function postTranscriptUpload(formData: FormData) {
  const { POST } = await import(
    "@/app/api/meetings/[meetingId]/uploads/transcript/route"
  );

  return POST(
    new Request(
      "https://app.example.com/api/meetings/meeting_123/uploads/transcript",
      {
        method: "POST",
        body: formData,
      },
    ),
    { params: Promise.resolve({ meetingId: "meeting_123" }) },
  );
}

describe("meeting recovery upload routes", () => {
  beforeEach(() => {
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "example.com",
    });
    assertCanManageMeeting.mockResolvedValue(undefined);
  });

  afterEach(() => {
    completeManualTranscriptUpload.mockReset();
    completeMeetingAudioUpload.mockReset();
    assertCanManageMeeting.mockReset();
    getCurrentUser.mockReset();
    getObjectMetadata.mockReset();
    deleteObject.mockReset();
    getWorkspace.mockReset();
    putObject.mockReset();
    revalidatePath.mockReset();
    send.mockReset();
    vi.resetModules();
  });

  it("authorizes transcript recovery before parsing the multipart body", async () => {
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
    assertCanManageMeeting.mockRejectedValue(
      new MeetingRecoveryUploadError("Meeting not found"),
    );
    const formData = vi.fn();
    const { POST } = await import(
      "@/app/api/meetings/[meetingId]/uploads/transcript/route"
    );

    const response = await POST(
      {
        formData,
        headers: new Headers(),
      } as unknown as Request,
      { params: Promise.resolve({ meetingId: "meeting_123" }) },
    );

    expect(response.status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
  });

  it("attaches an uploaded MP3 to the existing meeting and queues transcription", async () => {
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
    getObjectMetadata.mockResolvedValue({
      contentLength: 2048,
      contentType: "audio/mpeg",
    });
    deleteObject.mockResolvedValue(undefined);
    completeMeetingAudioUpload.mockResolvedValue({
      mediaAssetId: "asset_123",
      meetingId: "meeting_123",
      objectKey: "users/user_123/uploads/upload_123.mp3",
      transcriptJobId: "job_123",
    });
    send.mockResolvedValue({ ids: ["evt_123"] });

    const response = await postAudioComplete({
      uploadId: "upload_123",
      extension: "mp3",
      contentType: "audio/mpeg",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      meetingId: "meeting_123",
      redirectTo: "/meetings/meeting_123",
    });
    expect(completeMeetingAudioUpload).toHaveBeenCalledWith({
      fileSizeBytes: 2048,
      meetingId: "meeting_123",
      mimeType: "audio/mpeg",
      objectKey: "users/user_123/uploads/upload_123.mp3",
      workspace: {
        userId: "user_123",
        teamId: "team_123",
        domain: "example.com",
      },
    });
    expect(send).toHaveBeenCalledWith({
      id: "upload-transcription:job_123",
      name: "meeting/transcribe.audio",
      data: {
        mediaAssetId: "asset_123",
        meetingId: "meeting_123",
        objectKey: "users/user_123/uploads/upload_123.mp3",
        transcriptJobId: "job_123",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/meetings/meeting_123");
  });

  it("rejects oversized recovery uploads before attaching them", async () => {
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
    getObjectMetadata.mockResolvedValue({
      contentLength: 1_000_000_001,
      contentType: "audio/mpeg",
    });

    const response = await postAudioComplete({
      uploadId: "upload_123",
      extension: "mp3",
      contentType: "audio/mpeg",
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Recording file must be 1 GB or smaller",
    });
    expect(completeMeetingAudioUpload).not.toHaveBeenCalled();
    expect(deleteObject).toHaveBeenCalledWith({
      key: "users/user_123/uploads/upload_123.mp3",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("attaches an uploaded M4A to the existing meeting and queues transcription", async () => {
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
    getObjectMetadata.mockResolvedValue({
      contentLength: 4096,
      contentType: "audio/mp4",
    });
    completeMeetingAudioUpload.mockResolvedValue({
      mediaAssetId: "asset_123",
      meetingId: "meeting_123",
      objectKey: "users/user_123/uploads/upload_123.m4a",
      transcriptJobId: "job_123",
    });
    send.mockResolvedValue({ ids: ["evt_123"] });

    const response = await postAudioComplete({
      uploadId: "upload_123",
      extension: "m4a",
      contentType: "audio/mp4",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      meetingId: "meeting_123",
      redirectTo: "/meetings/meeting_123",
    });
    expect(completeMeetingAudioUpload).toHaveBeenCalledWith({
      fileSizeBytes: 4096,
      meetingId: "meeting_123",
      mimeType: "audio/mp4",
      objectKey: "users/user_123/uploads/upload_123.m4a",
      workspace: {
        userId: "user_123",
        teamId: "team_123",
        domain: "example.com",
      },
    });
    expect(send).toHaveBeenCalledWith({
      id: "upload-transcription:job_123",
      name: "meeting/transcribe.audio",
      data: {
        mediaAssetId: "asset_123",
        meetingId: "meeting_123",
        objectKey: "users/user_123/uploads/upload_123.m4a",
        transcriptJobId: "job_123",
      },
    });
  });

  it("uploads an MP3 through the app server when direct upload is unavailable", async () => {
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
    putObject.mockResolvedValue(undefined);
    completeMeetingAudioUpload.mockResolvedValue({
      mediaAssetId: "asset_123",
      meetingId: "meeting_123",
      objectKey: "users/user_123/uploads/upload_123.mp3",
      transcriptJobId: "job_123",
    });
    send.mockResolvedValue({ ids: ["evt_123"] });

    const formData = new FormData();
    formData.set(
      "meeting-audio",
      new File([new Uint8Array([1, 2, 3])], "local.mp3", {
        type: "audio/mpeg",
      }),
    );

    const response = await postAudioUpload(formData);
    const objectKey = putObject.mock.calls[0]?.[0]?.key;

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: true,
      key: objectKey,
      meetingId: "meeting_123",
      redirectTo: "/meetings/meeting_123",
    });
    expect(putObject).toHaveBeenCalledWith({
      key: expect.stringMatching(/^users\/user_123\/uploads\/.+\.mp3$/),
      body: expect.any(Uint8Array),
      contentType: "audio/mpeg",
    });
    expect(completeMeetingAudioUpload).toHaveBeenCalledWith({
      fileSizeBytes: 3,
      meetingId: "meeting_123",
      mimeType: "audio/mpeg",
      objectKey,
      workspace: {
        userId: "user_123",
        teamId: "team_123",
        domain: "example.com",
      },
    });
    expect(send).toHaveBeenCalledWith({
      id: "upload-transcription:job_123",
      name: "meeting/transcribe.audio",
      data: {
        mediaAssetId: "asset_123",
        meetingId: "meeting_123",
        objectKey: "users/user_123/uploads/upload_123.mp3",
        transcriptJobId: "job_123",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/meetings/meeting_123");
  });

  it("rejects an unauthorized fallback upload before storing the object", async () => {
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
    assertCanManageMeeting.mockRejectedValue(
      new MeetingRecoveryUploadError("Meeting not found"),
    );
    const formData = new FormData();
    formData.set(
      "meeting-audio",
      new File([new Uint8Array([1, 2, 3])], "local.mp3", {
        type: "audio/mpeg",
      }),
    );

    const response = await postAudioUpload(formData);

    expect(response.status).toBe(403);
    expect(putObject).not.toHaveBeenCalled();
    expect(completeMeetingAudioUpload).not.toHaveBeenCalled();
  });

  it("accepts transcript text without speaker names for the existing meeting", async () => {
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
    completeManualTranscriptUpload.mockResolvedValue({
      meetingId: "meeting_123",
      segmentCount: 1,
      transcriptJobId: "job_123",
    });
    const formData = new FormData();
    formData.set("transcriptText", "This is a transcript without a speaker.");

    const response = await postTranscriptUpload(formData);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      meetingId: "meeting_123",
      ready: true,
      segmentCount: 1,
    });
    expect(completeManualTranscriptUpload).toHaveBeenCalledWith({
      meetingId: "meeting_123",
      transcriptText: "This is a transcript without a speaker.",
      workspace: {
        userId: "user_123",
        teamId: "team_123",
        domain: "example.com",
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    expect(revalidatePath).toHaveBeenCalledWith("/meetings/meeting_123");
  });
});
