import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), metadata: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/r2", async (original) => ({
  ...await original<typeof import("@/lib/r2")>(),
  createR2Client: () => ({ send: mocks.send }),
  getObjectMetadata: mocks.metadata,
  parseR2Env: () => ({ R2_BUCKET: "recordings" }),
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));
import { ObjectNotFoundError } from "@/lib/r2";
import { RECORDER_PART_BYTES as size, recorderMultipartAssetId, recorderMultipartSchema, recorderMultipartUpload } from "@/lib/local-recorder-multipart";

const scope = { attemptId: "attempt", meetingId: "meeting", teamId: "team" };
const base = { action: "status" as const, clientRecordingId: "recording", fallbackIntentId: "intent", recordingStartedAt: "2026-11-03T12:00:00Z", role: "computerAudio" as const, fileSize: size + 42, uploadId: "session" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.metadata.mockRejectedValue(new ObjectNotFoundError("key"));
});

describe("resumable recorder uploads", () => {
  it("recovers a committed part after the client lost its response", async () => {
    mocks.send.mockResolvedValue({ Parts: [{ PartNumber: 1, ETag: "etag1", Size: size }] });
    const result = await recorderMultipartUpload(base, scope);
    expect(result.completedParts).toEqual([1]);
    expect(result.complete).toBe(false);
    expect(mocks.send.mock.calls[0][0].input.UploadId).toBe("session");
  });
  it("does not skip incorrectly sized parts", async () => {
    mocks.send.mockResolvedValue({ Parts: [{ PartNumber: 1, ETag: "etag1", Size: 123 }] });
    expect((await recorderMultipartUpload(base, scope)).completedParts).toEqual([]);
  });
  it("refuses completion until all expected bytes are present", async () => {
    mocks.send.mockResolvedValue({ Parts: [{ PartNumber: 1, ETag: "etag1", Size: size }] });
    await expect(recorderMultipartUpload({ ...base, action: "complete" }, scope)).rejects.toThrow("unfinished parts");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it("completes using server verified ETags in part order", async () => {
    mocks.send.mockResolvedValueOnce({ Parts: [
      { PartNumber: 2, ETag: "etag2", Size: 42 }, { PartNumber: 1, ETag: "etag1", Size: size },
    ] }).mockResolvedValueOnce({});
    expect((await recorderMultipartUpload({ ...base, action: "complete" }, scope)).complete).toBe(true);
    expect(mocks.send.mock.calls[1][0].input.MultipartUpload.Parts).toEqual([
      { PartNumber: 1, ETag: "etag1" }, { PartNumber: 2, ETag: "etag2" },
    ]);
  });
  it("recognizes completion after its response was lost", async () => {
    mocks.metadata.mockResolvedValue({ contentLength: base.fileSize });
    expect((await recorderMultipartUpload(base, scope)).complete).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("reports expired sessions so the client can recover", async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error(), { name: "NoSuchUpload" }));
    expect(await recorderMultipartUpload(base, scope)).toMatchObject({ expired: true });
  });
  it("scopes object identities to the authorized recording intent and track", () => {
    const id = recorderMultipartAssetId("a", "recording", "computerAudio");
    expect(id).not.toBe(recorderMultipartAssetId("b", "recording", "computerAudio"));
    expect(id).not.toBe(recorderMultipartAssetId("a", "recording", "microphoneAudio"));
    expect(id).toMatch(/^[a-f0-9-]{36}$/);
  });
  it("rejects missing sessions and out of range part requests", () => {
    expect(recorderMultipartSchema.safeParse({ ...base, uploadId: undefined }).success).toBe(false);
    expect(recorderMultipartSchema.safeParse({ ...base, action: "part", partNumber: 3 }).success).toBe(false);
    expect(recorderMultipartSchema.safeParse({ ...base, action: "part", partNumber: 2 }).success).toBe(true);
  });
  it("refreshes a signed URL only for the requested unfinished part", async () => {
    mocks.sign.mockResolvedValue("https://storage.example.com/part");
    await recorderMultipartUpload({ ...base, action: "part", partNumber: 2 }, scope);
    expect(mocks.sign.mock.calls[0][1].input).toMatchObject({ PartNumber: 2, ContentLength: 42, UploadId: "session" });
  });
});


it("uploads AAC and screenshots with matching object extensions and MIME types", async () => {
  mocks.send.mockResolvedValue({ UploadId: "new-session" });
  await recorderMultipartUpload({ ...base, action: "start", format: "m4a" }, scope);
  expect(mocks.send.mock.calls[0][0].input).toMatchObject({ ContentType: "audio/mp4", Key: expect.stringMatching(/\.m4a$/) });
  await recorderMultipartUpload({ ...base, action: "start", role: "screenshot:0", format: "jpg", fileSize: 1000 }, scope);
  expect(mocks.send.mock.calls[1][0].input).toMatchObject({ ContentType: "image/jpeg", Key: expect.stringMatching(/\.jpg$/) });
});

it("rejects image formats on audio tracks and oversized screenshots", () => {
  expect(recorderMultipartSchema.safeParse({ ...base, format: "jpg" }).success).toBe(false);
  expect(recorderMultipartSchema.safeParse({ ...base, role: "screenshot:0", format: "m4a" }).success).toBe(false);
  expect(recorderMultipartSchema.safeParse({ ...base, role: "screenshot:0", format: "jpg" }).success).toBe(false);
  expect(recorderMultipartSchema.safeParse({ ...base, role: "screenshot:0", format: "jpg", fileSize: 1000 }).success).toBe(true);
});
