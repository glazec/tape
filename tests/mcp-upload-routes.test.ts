import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertCanCreateMeetings,
  assertRequestRateLimit,
  assertWorkspaceHasProviderCredit,
  createUploadUrl,
  createUploadedAudioBatch,
  deleteObject,
  dispatchAudioBatchTranscriptions,
  getObjectMetadata,
  getWorkspace,
  revalidatePath,
} = vi.hoisted(() => ({
  assertCanCreateMeetings: vi.fn(),
  assertRequestRateLimit: vi.fn(),
  assertWorkspaceHasProviderCredit: vi.fn(),
  createUploadUrl: vi.fn(),
  createUploadedAudioBatch: vi.fn(),
  deleteObject: vi.fn(),
  dispatchAudioBatchTranscriptions: vi.fn(),
  getObjectMetadata: vi.fn(),
  getWorkspace: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/audio-batch-dispatch", () => ({
  dispatchAudioBatchTranscriptions,
}));
vi.mock("@/lib/meeting-audio-batches", () => ({ createUploadedAudioBatch }));
vi.mock("@/lib/provider-credit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-credit")>()),
  assertWorkspaceHasProviderCredit,
}));
vi.mock("@/lib/request-rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-rate-limit")>()),
  assertRequestRateLimit,
}));
vi.mock("@/lib/r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2")>()),
  createUploadUrl,
  deleteObject,
  getObjectMetadata,
}));
vi.mock("@/lib/workspace", () => ({
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
}));

import {
  createMcpUploadToken,
  parseMcpUploadToken,
} from "@/lib/mcp-upload-token";

const sharedSecret = "mcp-backend-test-secret-that-is-long-enough";
const authUserId = "auth-user-123";
const userId = "22222222-2222-4222-8222-222222222222";

function signedRequest(url: string, input: unknown) {
  const rawBody = JSON.stringify({
    input,
    user: {
      email: "member@example.com",
      id: authUserId,
      name: "Member",
    },
  });
  const requestId = crypto.randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", sharedSecret)
    .update(`${requestId}.${timestamp}.${rawBody}`)
    .digest("base64url");

  return new Request(url, {
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-tape-mcp-id": requestId,
      "x-tape-mcp-signature": `v1,${signature}`,
      "x-tape-mcp-timestamp": timestamp,
    },
  });
}

function completionToken(overrides: Record<string, unknown> = {}) {
  return createMcpUploadToken({
    authUserId,
    contentType: "audio/mpeg",
    durationMs: 60_000,
    expiresAt: Math.floor(Date.now() / 1000) + 900,
    extension: "mp3",
    fileName: "meeting.mp3",
    fileSizeBytes: 123,
    meetingTime: "2026-08-17T15:00:00.000Z",
    title: "MCP test meeting",
    uploadId: "11111111-1111-4111-8111-111111111111",
    userId,
    version: 1,
    ...overrides,
  });
}

beforeEach(() => {
  process.env.MCP_BACKEND_SHARED_SECRET = sharedSecret;
  getWorkspace.mockResolvedValue({ teamId: "team-123", userId });
  createUploadUrl.mockResolvedValue("https://uploads.example.com/signed");
  getObjectMetadata.mockResolvedValue({
    contentLength: 123,
    contentType: "audio/mpeg",
  });
  createUploadedAudioBatch.mockResolvedValue({
    existing: false,
    meetingId: "44444444-4444-4444-8444-444444444444",
    transcriptions: [
      {
        mediaAssetId: "33333333-3333-4333-8333-333333333333",
        meetingId: "44444444-4444-4444-8444-444444444444",
        objectKey:
          "users/auth-user-123/uploads/11111111-1111-4111-8111-111111111111.mp3",
        recordingId: "55555555-5555-4555-8555-555555555555",
        transcriptJobId: "66666666-6666-4666-8666-666666666666",
      },
    ],
  });
  dispatchAudioBatchTranscriptions.mockResolvedValue({ delayedCount: 0 });
});

afterEach(() => {
  delete process.env.MCP_BACKEND_SHARED_SECRET;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("POST /api/mcp/uploads/prepare", () => {
  it("returns a direct upload URL and identity bound completion token", async () => {
    const { POST } = await import("@/app/api/mcp/uploads/prepare/route");
    const response = await POST(
      signedRequest("https://app.example.com/api/mcp/uploads/prepare", {
        contentType: "audio/mpeg",
        durationMs: 60_000,
        fileName: "meeting.mp3",
        fileSizeBytes: 123,
        meetingTime: "2026-08-17T15:00:00.000Z",
        title: "MCP test meeting",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.uploadUrl).toBe("https://uploads.example.com/signed");
    expect(payload.uploadHeaders).toEqual({ "Content-Type": "audio/mpeg" });
    expect(payload.completionToken).toEqual(expect.any(String));
    expect(
      parseMcpUploadToken(payload.completionToken).expiresAt -
        Math.floor(new Date(payload.expiresAt).getTime() / 1000),
    ).toBe(15 * 60);
    expect(createUploadUrl).toHaveBeenCalledWith({
      contentType: "audio/mpeg",
      key: expect.stringMatching(
        /^users\/auth-user-123\/uploads\/[0-9a-f-]+\.mp3$/,
      ),
    });
    expect(assertCanCreateMeetings).toHaveBeenCalled();
    expect(assertWorkspaceHasProviderCredit).toHaveBeenCalled();
    expect(assertRequestRateLimit).toHaveBeenCalled();
  });

  it("rejects unsigned requests before creating an upload URL", async () => {
    const { POST } = await import("@/app/api/mcp/uploads/prepare/route");
    const response = await POST(
      new Request("https://app.example.com/api/mcp/uploads/prepare", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(createUploadUrl).not.toHaveBeenCalled();
  });
});

describe("POST /api/mcp/uploads/complete", () => {
  it("creates the meeting at the prepared time and queues transcription", async () => {
    const { POST } = await import("@/app/api/mcp/uploads/complete/route");
    const response = await POST(
      signedRequest("https://app.example.com/api/mcp/uploads/complete", {
        completionToken: completionToken(),
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      delayedCount: 0,
      existing: false,
      meetingId: "44444444-4444-4444-8444-444444444444",
      queued: true,
      redirectTo: "/meetings/44444444-4444-4444-8444-444444444444",
      status: "processing",
    });
    expect(createUploadedAudioBatch).toHaveBeenCalledWith({
      files: [
        {
          durationMs: 60_000,
          fileName: "meeting.mp3",
          fileSizeBytes: 123,
          mimeType: "audio/mpeg",
          objectKey:
            "users/auth-user-123/uploads/11111111-1111-4111-8111-111111111111.mp3",
        },
      ],
      startedAt: new Date("2026-08-17T15:00:00.000Z"),
      title: "MCP test meeting",
      workspace: { teamId: "team-123", userId },
    });
    expect(dispatchAudioBatchTranscriptions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          transcriptJobId: "66666666-6666-4666-8666-666666666666",
        }),
      ]),
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      "/meetings/44444444-4444-4444-8444-444444444444",
    );
  });

  it("reuses an already completed upload instead of creating a duplicate", async () => {
    createUploadedAudioBatch.mockResolvedValue({
      existing: true,
      meetingId: "44444444-4444-4444-8444-444444444444",
      transcriptions: [],
    });
    const { POST } = await import("@/app/api/mcp/uploads/complete/route");
    const response = await POST(
      signedRequest("https://app.example.com/api/mcp/uploads/complete", {
        completionToken: completionToken(),
      }),
    );

    expect(response.status).toBe(202);
    expect((await response.json()).existing).toBe(true);
    expect(createUploadedAudioBatch).toHaveBeenCalledOnce();
    expect(dispatchAudioBatchTranscriptions).toHaveBeenCalledWith([]);
  });

  it("deletes and rejects a partial local file upload", async () => {
    getObjectMetadata.mockResolvedValue({
      contentLength: 100,
      contentType: "audio/mpeg",
    });
    const { POST } = await import("@/app/api/mcp/uploads/complete/route");
    const response = await POST(
      signedRequest("https://app.example.com/api/mcp/uploads/complete", {
        completionToken: completionToken(),
      }),
    );

    expect(response.status).toBe(400);
    expect(deleteObject).toHaveBeenCalledWith({
      key: "users/auth-user-123/uploads/11111111-1111-4111-8111-111111111111.mp3",
    });
    expect(createUploadedAudioBatch).not.toHaveBeenCalled();
  });

  it("deletes and rejects an uploaded file with a substituted content type", async () => {
    getObjectMetadata.mockResolvedValue({
      contentLength: 123,
      contentType: "audio/mp4",
    });
    const { POST } = await import("@/app/api/mcp/uploads/complete/route");
    const response = await POST(
      signedRequest("https://app.example.com/api/mcp/uploads/complete", {
        completionToken: completionToken(),
      }),
    );

    expect(response.status).toBe(400);
    expect(deleteObject).toHaveBeenCalledWith({
      key: "users/auth-user-123/uploads/11111111-1111-4111-8111-111111111111.mp3",
    });
    expect(createUploadedAudioBatch).not.toHaveBeenCalled();
  });
});
