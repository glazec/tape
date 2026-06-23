import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

type MeetingObjectKeyInput = {
  teamId: string;
  meetingId: string;
  assetId: string;
  extension: string;
};

type PendingUploadObjectKeyInput = {
  userId: string;
  uploadId: string;
  extension: string;
};

type CreateUploadUrlInput = {
  key: string;
  contentType: string;
};

export class UnsafeObjectKeySegmentError extends Error {
  constructor(segmentName: string) {
    super(`Unsafe object key segment: ${segmentName}`);
    this.name = "UnsafeObjectKeySegmentError";
  }
}

const r2EnvSchema = z.object({
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
});

export function assertSafeObjectKeySegment(value: string, segmentName = "segment") {
  if (
    value.length === 0 ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    /\s/.test(value)
  ) {
    throw new UnsafeObjectKeySegmentError(segmentName);
  }
}

export function buildMeetingObjectKey(input: MeetingObjectKeyInput) {
  assertSafeObjectKeySegment(input.teamId, "teamId");
  assertSafeObjectKeySegment(input.meetingId, "meetingId");
  assertSafeObjectKeySegment(input.assetId, "assetId");
  assertSafeObjectKeySegment(input.extension, "extension");

  return `teams/${input.teamId}/meetings/${input.meetingId}/assets/${input.assetId}.${input.extension}`;
}

export function buildPendingUploadObjectKey(input: PendingUploadObjectKeyInput) {
  assertSafeObjectKeySegment(input.userId, "userId");
  assertSafeObjectKeySegment(input.uploadId, "uploadId");
  assertSafeObjectKeySegment(input.extension, "extension");

  return `users/${input.userId}/uploads/${input.uploadId}.${input.extension}`;
}

export async function createUploadUrl(input: CreateUploadUrlInput) {
  const env = r2EnvSchema.parse(process.env);
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: input.key,
    ContentType: input.contentType,
  });

  return getSignedUrl(client, command, { expiresIn: 900 });
}
