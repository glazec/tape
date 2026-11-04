import {
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

type CreateReadUrlInput = {
  key: string;
};

type GetObjectMetadataInput = {
  key: string;
};

type DeleteObjectInput = {
  key: string;
};

type PutObjectInput = {
  onlyIfAbsent?: boolean;
  key: string;
  body: Uint8Array;
  contentType: string;
};

export class UnsafeObjectKeySegmentError extends Error {
  constructor(segmentName: string) {
    super(`Unsafe object key segment: ${segmentName}`);
    this.name = "UnsafeObjectKeySegmentError";
  }
}

export class ObjectAlreadyExistsError extends Error {}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = "ObjectNotFoundError";
  }
}

const requiredTrimmedString = z
  .string()
  .transform((value) => value.replace(/\\r|\\n/g, "").trim())
  .pipe(z.string().min(1));

const r2EnvSchema = z.object({
  R2_ACCOUNT_ID: requiredTrimmedString,
  R2_ACCESS_KEY_ID: requiredTrimmedString,
  R2_SECRET_ACCESS_KEY: requiredTrimmedString,
  R2_BUCKET: requiredTrimmedString,
});

export function parseR2Env(source: Record<string, string | undefined>) {
  return r2EnvSchema.parse(source);
}

export function assertSafeObjectKeySegment(
  value: string,
  segmentName = "segment",
) {
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

export function buildPendingUploadObjectKey(
  input: PendingUploadObjectKeyInput,
) {
  assertSafeObjectKeySegment(input.userId, "userId");
  assertSafeObjectKeySegment(input.uploadId, "uploadId");
  assertSafeObjectKeySegment(input.extension, "extension");

  return `users/${input.userId}/uploads/${input.uploadId}.${input.extension}`;
}

export async function createUploadUrl(input: CreateUploadUrlInput) {
  const client = createR2Client();
  const env = parseR2Env(process.env);
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: input.key,
    ContentType: input.contentType,
  });

  return getSignedUrl(client, command, { expiresIn: 900 });
}

export async function createReadUrl(input: CreateReadUrlInput) {
  const client = createR2Client();
  const env = parseR2Env(process.env);
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: input.key,
  });

  return getSignedUrl(client, command, { expiresIn: 900 });
}

export async function getObjectMetadata(input: GetObjectMetadataInput) {
  const client = createR2Client();
  const env = parseR2Env(process.env);
  const command = new HeadObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: input.key,
  });

  try {
    const response = await client.send(command);

    return {
      contentLength: response.ContentLength,
      contentType: response.ContentType,
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new ObjectNotFoundError(input.key);
    }

    throw error;
  }
}

export async function deleteObject(input: DeleteObjectInput) {
  const client = createR2Client();
  const env = parseR2Env(process.env);

  await client.send(
    new DeleteObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: input.key,
    }),
  );
}

export async function putObject(input: PutObjectInput) {
  const client = createR2Client();
  const env = parseR2Env(process.env);
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ...(input.onlyIfAbsent ? { IfNoneMatch: "*" } : {}),
  });

  try {
    await client.send(command);
  } catch (error) {
    const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    if (input.onlyIfAbsent && (candidate?.name === "PreconditionFailed" || candidate?.$metadata?.httpStatusCode === 412)) {
      throw new ObjectAlreadyExistsError("This recording upload already exists");
    }
    throw error;
  }
}

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };

  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

export function createR2Client() {
  const env = parseR2Env(process.env);

  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}
