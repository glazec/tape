import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  assertCanManageMeeting,
  assertRequestRateLimit,
  assertWorkspaceHasProviderCredit,
  attachUploadedAudioBatch,
  createAudioBatchUploadUrls,
  createUploadedAudioBatch,
  dispatchAudioBatchTranscriptions,
  getCurrentUser,
  getWorkspace,
  pendingSafeParse,
  revalidatePath,
  resolvePendingAudioBatch,
  safeParse,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  assertCanManageMeeting: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertWorkspaceHasProviderCredit: vi.fn(),
  attachUploadedAudioBatch: vi.fn(),
  createAudioBatchUploadUrls: vi.fn(),
  createUploadedAudioBatch: vi.fn(),
  dispatchAudioBatchTranscriptions: vi.fn(),
  getCurrentUser: vi.fn(),
  getWorkspace: vi.fn(),
  pendingSafeParse: vi.fn(),
  revalidatePath: vi.fn(),
  resolvePendingAudioBatch: vi.fn(),
  safeParse: vi.fn(),
}));

class AudioBatchStagingError extends Error {
  status = 400;
}
class MeetingRecoveryUploadError extends Error {}
class PendingAudioBatchError extends Error {
  status = 413;
}

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));
vi.mock("@/lib/meeting-recovery-uploads", () => ({
  assertCanManageMeeting,
  MeetingRecoveryUploadError,
}));
vi.mock("@/lib/audio-batch-staging", () => ({
  AudioBatchStagingError,
  audioBatchSignSchema: { safeParse },
  createAudioBatchUploadUrls,
  stageAudioBatchFormData: vi.fn(),
}));
vi.mock("@/lib/audio-batch-dispatch", () => ({
  dispatchAudioBatchTranscriptions,
}));
vi.mock("@/lib/meeting-audio-batches", () => ({
  attachUploadedAudioBatch,
  createUploadedAudioBatch,
}));
vi.mock("@/lib/pending-audio-batch", () => ({
  pendingAudioBatchSchema: { safeParse: pendingSafeParse },
  PendingAudioBatchError,
  resolvePendingAudioBatch,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/provider-credit", () => ({
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse: (error: unknown) =>
    error === creditError
      ? Response.json({ error: "No provider credit" }, { status: 402 })
      : null,
}));
vi.mock("@/lib/request-rate-limit", () => ({
  assertRequestRateLimit,
  requestRateLimitErrorResponse: (error: unknown) =>
    error === rateError
      ? Response.json({ error: "Too many requests" }, { status: 429 })
      : null,
  requestRateLimitPolicies: {
    serverMediaBatchStage: { limit: 10, scope: "stage", windowMs: 1 },
    serverMediaUpload: { limit: 10, scope: "upload", windowMs: 1 },
  },
}));

const creditError = new Error("credit");
const rateError = new Error("rate");
const workspace = { teamId: "team_1", userId: "user_1" };
const files = [
  { contentType: "audio/mpeg", extension: "mp3", fileSize: 100 },
  { contentType: "audio/mp4", extension: "m4a", fileSize: 200 },
];

describe("audio batch routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns 401 from every batch staging boundary", async () => {
    getCurrentUser.mockResolvedValue(null);
    const [{ POST: signNew }, { POST: signMeeting }, { POST: stageMeeting }] =
      await Promise.all([
        import("@/app/api/uploads/audio/batch/sign/route"),
        import("@/app/api/meetings/[meetingId]/uploads/audio/batch/sign/route"),
        import("@/app/api/meetings/[meetingId]/uploads/audio/batch/route"),
      ]);

    expect((await signNew(request(files))).status).toBe(401);
    expect((await signMeeting(request(files), context())).status).toBe(401);
    expect((await stageMeeting(request(files), context())).status).toBe(401);
  });

  it("signs one ordered new meeting batch after create authorization", async () => {
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue(workspace);
    safeParse.mockReturnValue({ success: true, data: { files } });
    createAudioBatchUploadUrls.mockResolvedValue([
      { uploadId: "upload_1", uploadUrl: "https://upload/1" },
      { uploadId: "upload_2", uploadUrl: "https://upload/2" },
    ]);
    const { POST } = await import("@/app/api/uploads/audio/batch/sign/route");

    const response = await POST(request(files));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      uploads: [
        { uploadId: "upload_1", uploadUrl: "https://upload/1" },
        { uploadId: "upload_2", uploadUrl: "https://upload/2" },
      ],
    });
    expect(assertCanCreateMeetings).toHaveBeenCalledWith(workspace);
    expect(assertRequestRateLimit).toHaveBeenCalledWith({
      cost: 2,
      limit: 10,
      scope: "upload",
      subject: "team_1:user_1",
      windowMs: 1,
    });
    expect(createAudioBatchUploadUrls).toHaveBeenCalledWith({
      files,
      userId: "user_1",
    });
  });

  it("authorizes meeting management before signing recovery files", async () => {
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue(workspace);
    safeParse.mockReturnValue({ success: true, data: { files } });
    createAudioBatchUploadUrls.mockResolvedValue([]);
    const { POST } =
      await import("@/app/api/meetings/[meetingId]/uploads/audio/batch/sign/route");

    expect((await POST(request(files), context())).status).toBe(200);
    expect(assertCanManageMeeting).toHaveBeenCalledWith(workspace, "meeting_1");
    expect(assertCanManageMeeting.mock.invocationCallOrder[0]).toBeLessThan(
      createAudioBatchUploadUrls.mock.invocationCallOrder[0]!,
    );
  });

  it("maps malformed, credit, and rate failures", async () => {
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue(workspace);
    safeParse.mockReturnValue({ success: false });
    const { POST } = await import("@/app/api/uploads/audio/batch/sign/route");

    expect((await POST(request(files))).status).toBe(400);

    assertWorkspaceHasProviderCredit.mockRejectedValueOnce(creditError);
    expect((await POST(request(files))).status).toBe(402);

    safeParse.mockReturnValue({ success: true, data: { files } });
    assertRequestRateLimit.mockRejectedValueOnce(rateError);
    expect((await POST(request(files))).status).toBe(429);
  });

  it("returns 401 from both batch completion routes", async () => {
    getCurrentUser.mockResolvedValue(null);
    const [{ POST: completeNew }, { POST: completeMeeting }] =
      await Promise.all([
        import("@/app/api/uploads/audio/batch/complete/route"),
        import("@/app/api/meetings/[meetingId]/uploads/audio/batch/complete/route"),
      ]);

    expect((await completeNew(request(files))).status).toBe(401);
    expect((await completeMeeting(request(files), context())).status).toBe(401);
  });

  it("rejects malformed batch completion before resolving uploads", async () => {
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue(workspace);
    pendingSafeParse.mockReturnValue({ success: false });
    const [{ POST: completeNew }, { POST: completeMeeting }] =
      await Promise.all([
        import("@/app/api/uploads/audio/batch/complete/route"),
        import("@/app/api/meetings/[meetingId]/uploads/audio/batch/complete/route"),
      ]);

    expect((await completeNew(request(files))).status).toBe(400);
    expect((await completeMeeting(request(files), context())).status).toBe(400);
    expect(resolvePendingAudioBatch).not.toHaveBeenCalled();
  });

  it("creates an ordered meeting batch and reports delayed dispatch", async () => {
    const parsedFiles = [
      {
        ...files[0],
        durationMs: 1_000,
        fileName: "first.mp3",
        uploadId: "one",
      },
      {
        ...files[1],
        durationMs: 2_000,
        fileName: "second.m4a",
        uploadId: "two",
      },
    ];
    const resolvedFiles = [
      { fileName: "first.mp3", objectKey: "users/user_1/one.mp3" },
      { fileName: "second.m4a", objectKey: "users/user_1/two.m4a" },
    ];
    const transcriptions = [
      { transcriptJobId: "job_1" },
      { transcriptJobId: "job_2" },
    ];
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue(workspace);
    pendingSafeParse.mockReturnValue({
      success: true,
      data: { files: parsedFiles, startedAt: "2026-08-16T12:00:00.000Z" },
    });
    resolvePendingAudioBatch.mockResolvedValue(resolvedFiles);
    createUploadedAudioBatch.mockResolvedValue({
      meetingId: "meeting_new",
      transcriptions,
    });
    dispatchAudioBatchTranscriptions.mockResolvedValue({ delayedCount: 1 });
    const { POST } =
      await import("@/app/api/uploads/audio/batch/complete/route");

    const response = await POST(request(parsedFiles));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      delayedCount: 1,
      meetingId: "meeting_new",
      queued: true,
      redirectTo: "/meetings/meeting_new",
    });
    expect(assertCanCreateMeetings).toHaveBeenCalledWith(workspace);
    expect(assertCanCreateMeetings.mock.invocationCallOrder[0]).toBeLessThan(
      resolvePendingAudioBatch.mock.invocationCallOrder[0]!,
    );
    expect(resolvePendingAudioBatch).toHaveBeenCalledWith({
      files: parsedFiles,
      userId: "user_1",
    });
    expect(createUploadedAudioBatch).toHaveBeenCalledWith({
      files: resolvedFiles,
      startedAt: new Date("2026-08-16T12:00:00.000Z"),
      title: "first",
      workspace,
    });
    expect(dispatchAudioBatchTranscriptions).toHaveBeenCalledWith(
      transcriptions,
    );
  });

  it("attaches an ordered recovery batch after manage authorization", async () => {
    const parsedFiles = [
      {
        ...files[0],
        durationMs: 1_000,
        fileName: "first.mp3",
        uploadId: "one",
      },
      {
        ...files[1],
        durationMs: 2_000,
        fileName: "second.m4a",
        uploadId: "two",
      },
    ];
    const resolvedFiles = [{ objectKey: "one" }, { objectKey: "two" }];
    const transcriptions = [
      { transcriptJobId: "job_1" },
      { transcriptJobId: "job_2" },
    ];
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue(workspace);
    pendingSafeParse.mockReturnValue({
      success: true,
      data: { files: parsedFiles },
    });
    resolvePendingAudioBatch.mockResolvedValue(resolvedFiles);
    attachUploadedAudioBatch.mockResolvedValue({ transcriptions });
    dispatchAudioBatchTranscriptions.mockResolvedValue({ delayedCount: 0 });
    const { POST } =
      await import("@/app/api/meetings/[meetingId]/uploads/audio/batch/complete/route");

    const response = await POST(request(parsedFiles), context());

    expect(response.status).toBe(202);
    expect(assertCanManageMeeting).toHaveBeenCalledWith(workspace, "meeting_1");
    expect(assertCanManageMeeting.mock.invocationCallOrder[0]).toBeLessThan(
      resolvePendingAudioBatch.mock.invocationCallOrder[0]!,
    );
    expect(attachUploadedAudioBatch).toHaveBeenCalledWith({
      files: resolvedFiles,
      meetingId: "meeting_1",
      startedAt: expect.any(Date),
      workspace,
    });
    expect(dispatchAudioBatchTranscriptions).toHaveBeenCalledWith(
      transcriptions,
    );
  });

  it("maps completion policy and upload validation failures", async () => {
    getCurrentUser.mockResolvedValue({ id: "user_1" });
    getWorkspace.mockResolvedValue(workspace);
    pendingSafeParse.mockReturnValue({ success: true, data: { files: [] } });
    resolvePendingAudioBatch.mockRejectedValueOnce(
      new PendingAudioBatchError("Each recording file must be 1 GB or smaller"),
    );
    const { POST: completeNew } =
      await import("@/app/api/uploads/audio/batch/complete/route");

    expect((await completeNew(request(files))).status).toBe(413);

    assertCanManageMeeting.mockRejectedValueOnce(
      new MeetingRecoveryUploadError("Meeting not found"),
    );
    const { POST: completeMeeting } =
      await import("@/app/api/meetings/[meetingId]/uploads/audio/batch/complete/route");
    expect((await completeMeeting(request(files), context())).status).toBe(403);
  });
});

function request(body: unknown) {
  return new Request("https://app.example.com/api/uploads/audio/batch/sign", {
    body: JSON.stringify({ files: body }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function context() {
  return { params: Promise.resolve({ meetingId: "meeting_1" }) };
}
