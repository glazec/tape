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
const assertCanCreateMeetings = vi.fn();
const putObject = vi.fn();
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

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    putObject,
    getObjectMetadata,
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
  fields: Record<string, string | undefined> = {},
) {
  const { POST } = await import("@/app/api/uploads/audio/route");
  const formData = new FormData();
  formData.set("meeting-audio", file);
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) formData.set(key, value);

  return POST(
    new Request("https://app.example.com/api/uploads/audio", {
      method: "POST",
      body: formData,
    }),
  );
}

describe("POST /api/uploads/audio", () => {
  beforeEach(() => {
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "example.com",
    });
    assertCanCreateMeetings.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    assertCanCreateMeetings.mockReset();
    getCurrentUser.mockReset();
    getWorkspace.mockReset();
    putObject.mockReset();
    getObjectMetadata.mockReset();
    createUploadedAudioTranscription.mockReset();
    createUploadedVideoTranscription.mockReset();
    revalidatePath.mockReset();
    send.mockReset();
    vi.resetModules();
  });

  it.each(["audio", "video"])("preserves %s destination, title, interval and upload identity on fallback", async (kind) => {
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com", name: null });
    const create = kind === "audio" ? createUploadedAudioTranscription : createUploadedVideoTranscription;
    create.mockResolvedValue({ meetingId: "22222222-2222-4222-8222-222222222222", transcriptJobId: "job" });
    const response = await postAudioUpload(new File(["recording"], kind === "audio" ? "sample.mp3" : "sample.mp4", { type: kind === "audio" ? "audio/mpeg" : "video/mp4" }), {
      uploadId: "same-upload", meetingId: "22222222-2222-4222-8222-222222222222", title: "  Chosen title  ", startedAt: "2026-10-19T15:41:00Z", durationMs: "5127900",
    });
    expect(response.status).toBe(202);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      meetingId: "22222222-2222-4222-8222-222222222222", title: "Chosen title", startedAt: new Date("2026-10-19T15:41:00Z"), durationMs: 5127900,
      objectKey: `users/user_123/uploads/same-upload.${kind === "audio" ? "mp3" : "mp4"}`,
    }));
    expect(putObject).toHaveBeenCalledWith(expect.objectContaining({ onlyIfAbsent: true }));
  });

  it("reuses an existing matching object without overwriting it", async () => {
    const { ObjectAlreadyExistsError } = await import("@/lib/r2");
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com", name: null });
    putObject.mockRejectedValue(new ObjectAlreadyExistsError());
    getObjectMetadata.mockResolvedValue({ contentLength: 3, contentType: "audio/mpeg" });
    createUploadedAudioTranscription.mockResolvedValue({ meetingId: "meeting", transcriptJobId: "job" });
    const response = await postAudioUpload(new File(["abc"], "sample.mp3", { type: "audio/mpeg" }), { uploadId: "same-upload" });
    expect(response.status).toBe(202);
    expect(createUploadedAudioTranscription).toHaveBeenCalledOnce();
  });

  it("rejects a reused upload id with mismatched media", async () => {
    const { ObjectAlreadyExistsError } = await import("@/lib/r2");
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com", name: null });
    putObject.mockRejectedValue(new ObjectAlreadyExistsError());
    getObjectMetadata.mockResolvedValue({ contentLength: 99, contentType: "audio/mpeg" });
    const response = await postAudioUpload(new File(["abc"], "sample.mp3", { type: "audio/mpeg" }), { uploadId: "same-upload" });
    expect(response.status).toBe(409);
    expect(createUploadedAudioTranscription).not.toHaveBeenCalled();
  });

  it.each([403, 409] as const)("retains actionable fallback target failure %s", async (status) => {
    const { RecordingImportError } = await import("@/lib/recording-import-error");
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com", name: null });
    createUploadedAudioTranscription.mockRejectedValue(new RecordingImportError("Choose another meeting", status));
    const response = await postAudioUpload(new File(["abc"], "sample.mp3", { type: "audio/mpeg" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: "Choose another meeting" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([{ title: " " }, { title: "x".repeat(301) }, { meetingId: "invalid" }, { durationMs: "-1" }])("rejects invalid fallback fields %j", async (fields) => {
    getCurrentUser.mockResolvedValue({ id: "user_123", email: "user@example.com", name: null });
    expect((await postAudioUpload(new File(["abc"], "sample.mp3", { type: "audio/mpeg" }), fields)).status).toBe(400);
    expect(putObject).not.toHaveBeenCalled();
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

  it("checks provider credit before parsing a multipart upload", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    const {
      assertWorkspaceHasProviderCredit,
      ProviderCreditExhaustedError,
    } = await import("@/lib/provider-credit");
    vi.mocked(assertWorkspaceHasProviderCredit).mockRejectedValueOnce(
      new ProviderCreditExhaustedError(5_000_000),
    );
    const formData = vi.fn();
    const { POST } = await import("@/app/api/uploads/audio/route");

    const response = await POST({
      formData,
      headers: new Headers(),
    } as unknown as Request);

    expect(response.status).toBe(402);
    expect(formData).not.toHaveBeenCalled();
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
      redirectTo: "/meetings/22222222-2222-4222-8222-222222222222",
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
      id: "upload-transcription:44444444-4444-4444-8444-444444444444",
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

  it("keeps a persisted upload queued when immediate dispatch fails", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    );
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    putObject.mockResolvedValue(undefined);
    createUploadedAudioTranscription.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "44444444-4444-4444-8444-444444444444",
    });
    send.mockRejectedValue(new Error("Inngest unavailable"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const response = await postAudioUpload(
        new File(["fake mp3"], "sample.mp3", { type: "audio/mpeg" }),
      );

      expect(response.status).toBe(202);
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
      expect(consoleError).toHaveBeenCalledWith(
        "upload_dispatch_delayed",
        expect.objectContaining({
          meetingId: "22222222-2222-4222-8222-222222222222",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("rejects oversized fallback uploads before buffering the file", async () => {
    getCurrentUser.mockResolvedValue({
      id: "user_123",
      email: "user@example.com",
      name: null,
    });
    const file = new File(["small body"], "oversized.mp3", {
      type: "audio/mpeg",
    });
    Object.defineProperty(file, "size", { value: 1_000_000_001 });
    const formData = {
      get: (name: string) => (name === "meeting-audio" ? file : null),
    };
    const { POST } = await import("@/app/api/uploads/audio/route");

    const response = await POST({
      formData: vi.fn().mockResolvedValue(formData),
      headers: new Headers(),
    } as unknown as Request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Recording file must be 1 GB or smaller",
    });
    expect(putObject).not.toHaveBeenCalled();
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
      redirectTo: "/meetings/22222222-2222-4222-8222-222222222222",
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
      redirectTo: "/meetings/22222222-2222-4222-8222-222222222222",
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
      id: "upload-video-conversion:55555555-5555-4555-8555-555555555555",
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
