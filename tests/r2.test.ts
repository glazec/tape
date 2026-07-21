import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({ getSignedUrl: vi.fn(), send: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => ({
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  HeadObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  S3Client: class { send = aws.send; constructor(public input: unknown) {} },
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: aws.getSignedUrl }));

import {
  buildMeetingObjectKey,
  buildPendingUploadObjectKey,
  createReadUrl,
  createUploadUrl,
  deleteObject,
  getObjectMetadata,
  parseR2Env,
  putObject,
} from "@/lib/r2";

beforeEach(() => {
  vi.stubEnv("R2_ACCOUNT_ID", "account");
  vi.stubEnv("R2_ACCESS_KEY_ID", "access");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "recordings");
  aws.send.mockReset();
  aws.getSignedUrl.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("buildMeetingObjectKey", () => {
  it("builds the R2 object key for a meeting asset", () => {
    expect(
      buildMeetingObjectKey({
        teamId: "team_123",
        meetingId: "meeting_456",
        assetId: "asset_789",
        extension: "mp3",
      }),
    ).toBe("teams/team_123/meetings/meeting_456/assets/asset_789.mp3");
  });

  it("rejects traversal shaped segments", () => {
    expect(() =>
      buildMeetingObjectKey({
        teamId: "../other",
        meetingId: "meeting_456",
        assetId: "asset_789",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });

  it("rejects slash separated segments", () => {
    expect(() =>
      buildMeetingObjectKey({
        teamId: "team_123",
        meetingId: "a/b",
        assetId: "asset_789",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });
});

describe("buildPendingUploadObjectKey", () => {
  it("builds the R2 object key for a user scoped pending upload", () => {
    expect(
      buildPendingUploadObjectKey({
        userId: "user_123",
        uploadId: "upload_456",
        extension: "mp3",
      }),
    ).toBe("users/user_123/uploads/upload_456.mp3");
  });

  it("rejects unsafe user id segments", () => {
    expect(() =>
      buildPendingUploadObjectKey({
        userId: "user/123",
        uploadId: "upload_456",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });

  it("rejects unsafe upload id segments", () => {
    expect(() =>
      buildPendingUploadObjectKey({
        userId: "user_123",
        uploadId: "../upload",
        extension: "mp3",
      }),
    ).toThrow("Unsafe object key segment");
  });
});

describe("parseR2Env", () => {
  it("trims copied R2 credential values", () => {
    expect(
      parseR2Env({
        R2_ACCOUNT_ID: "account-id\n",
        R2_ACCESS_KEY_ID: "access-key-id\n",
        R2_SECRET_ACCESS_KEY: "secret-access-key\n",
        R2_BUCKET: "recordings\n",
      }),
    ).toEqual({
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "access-key-id",
      R2_SECRET_ACCESS_KEY: "secret-access-key",
      R2_BUCKET: "recordings",
    });
  });

  it("removes copied escaped newline markers from R2 values", () => {
    expect(
      parseR2Env({
        R2_ACCOUNT_ID: "account-id\\n",
        R2_ACCESS_KEY_ID: "access-key-id\\n",
        R2_SECRET_ACCESS_KEY: "secret-access-key\\n",
        R2_BUCKET: "recordings\\n",
      }),
    ).toEqual({
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "access-key-id",
      R2_SECRET_ACCESS_KEY: "secret-access-key",
      R2_BUCKET: "recordings",
    });
  });
});

describe("R2 operations", () => {
  it("creates signed upload and read URLs", async () => {
    aws.getSignedUrl.mockResolvedValueOnce("https://upload").mockResolvedValueOnce("https://read");
    await expect(createUploadUrl({ key: "key.mp3", contentType: "audio/mpeg" })).resolves.toBe("https://upload");
    await expect(createReadUrl({ key: "key.mp3" })).resolves.toBe("https://read");
    expect(aws.getSignedUrl).toHaveBeenCalledTimes(2);
    expect(aws.getSignedUrl.mock.calls[0]?.[2]).toEqual({ expiresIn: 900 });
  });

  it("reads object metadata", async () => {
    aws.send.mockResolvedValueOnce({ ContentLength: 42, ContentType: "audio/mpeg" });
    await expect(getObjectMetadata({ key: "key.mp3" })).resolves.toEqual({ contentLength: 42, contentType: "audio/mpeg" });
  });

  it("normalizes all S3 not found error variants", async () => {
    for (const error of [{ name: "NotFound" }, { name: "NoSuchKey" }, { $metadata: { httpStatusCode: 404 } }]) {
      aws.send.mockRejectedValueOnce(error);
      await expect(getObjectMetadata({ key: "missing" })).rejects.toThrow("Object not found: missing");
    }
    aws.send.mockRejectedValueOnce(new Error("network"));
    await expect(getObjectMetadata({ key: "key" })).rejects.toThrow("network");
  });

  it("deletes and writes objects", async () => {
    aws.send.mockResolvedValue(undefined);
    await deleteObject({ key: "old.mp3" });
    await putObject({ key: "new.mp3", body: new Uint8Array([1, 2]), contentType: "audio/mpeg" });
    expect(aws.send).toHaveBeenCalledTimes(2);
  });
});
