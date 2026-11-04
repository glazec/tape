import { createHash } from "node:crypto";
import {
  CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  ListPartsCommand, UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import { buildMeetingObjectKey, createR2Client, getObjectMetadata, ObjectNotFoundError, parseR2Env } from "@/lib/r2";

export const RECORDER_PART_BYTES = 8 * 1024 * 1024;
export const recorderMultipartSchema = z.strictObject({
  format: z.enum(["wav", "m4a", "jpg"]).optional(),
  action: z.enum(["start", "status", "part", "complete"]),
  clientRecordingId: z.string().min(1).max(200),
  fallbackIntentId: z.string().min(1).max(512),
  recordingStartedAt: z.iso.datetime(),
  role: z.union([z.enum(["computerAudio", "microphoneAudio", "synthesizedAudio"]), z.string().regex(/^screenshot:(0|[1-9][0-9]{0,4})$/)]),
  fileSize: z.number().int().positive().max(2_147_483_647),
  uploadId: z.string().min(1).max(2048).optional(),
  partNumber: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.role.startsWith("screenshot:") ? value.format !== "jpg" || value.fileSize > RECORDER_PART_BYTES : value.format === "jpg")
    ctx.addIssue({ code: "custom", message: "Invalid recording media format" });
  if (value.action !== "start" && !value.uploadId)
    ctx.addIssue({ code: "custom", message: "Upload ID required" });
  if (value.action === "part" && (!value.partNumber || value.partNumber > Math.ceil(value.fileSize / RECORDER_PART_BYTES)))
    ctx.addIssue({ code: "custom", message: "Invalid part number" });
});

export class RecorderMultipartConflict extends Error {}

export function recorderMultipartAssetId(attemptId: string, recordingId: string, role: string) {
  const hex = createHash("sha256").update(JSON.stringify([attemptId, recordingId, role])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function recorderMultipartUpload(
  input: z.infer<typeof recorderMultipartSchema>,
  scope: { attemptId: string; meetingId: string; teamId: string },
) {
  const assetId = recorderMultipartAssetId(scope.attemptId, input.clientRecordingId, input.role);
  const key = buildMeetingObjectKey({ ...scope, assetId, extension: input.format ?? "wav" });
  const client = createR2Client();
  const base = { Bucket: parseR2Env(process.env).R2_BUCKET, Key: key };
  const result = { assetId, partSize: RECORDER_PART_BYTES, uploadId: input.uploadId, completedParts: [] as number[], complete: false };

  // A successful completion whose response was lost must not upload again.
  try {
    const object = await getObjectMetadata({ key });
    if (object.contentLength !== input.fileSize) throw new RecorderMultipartConflict("Saved recording size changed");
    return { ...result, complete: true };
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }

  if (input.action === "start") {
    const created = await client.send(new CreateMultipartUploadCommand({ ...base, ContentType: input.format === "m4a" ? "audio/mp4" : input.format === "jpg" ? "image/jpeg" : "audio/wav" }));
    if (!created.UploadId) throw new Error("Missing multipart upload ID");
    return { ...result, uploadId: created.UploadId };
  }
  const session = { ...base, UploadId: input.uploadId! };
  if (input.action === "part") {
    return { ...result, uploadUrl: await getSignedUrl(client, new UploadPartCommand({
      ...session, PartNumber: input.partNumber,
      ContentLength: Math.min(RECORDER_PART_BYTES, input.fileSize - (input.partNumber! - 1) * RECORDER_PART_BYTES),
    }), { expiresIn: 900 }) };
  }

  const parts: { PartNumber: number; ETag: string; Size: number }[] = [];
  let marker: string | undefined;
  try {
    do {
      const page = await client.send(new ListPartsCommand({ ...session, PartNumberMarker: marker }));
      for (const part of page.Parts ?? []) {
        if (!part.PartNumber || !part.ETag || part.Size === undefined) throw new Error("Invalid uploaded part");
        parts.push({ PartNumber: part.PartNumber, ETag: part.ETag, Size: part.Size });
      }
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchUpload")
      return { ...result, expired: true };
    throw error;
  }
  const count = Math.ceil(input.fileSize / RECORDER_PART_BYTES);
  const valid = parts.filter(part => part.PartNumber <= count && part.Size === Math.min(RECORDER_PART_BYTES, input.fileSize - (part.PartNumber - 1) * RECORDER_PART_BYTES));
  if (input.action === "status") return { ...result, completedParts: valid.map(part => part.PartNumber) };
  if (valid.length !== count || parts.length !== count)
    throw new RecorderMultipartConflict("Recording upload has unfinished parts");
  await client.send(new CompleteMultipartUploadCommand({
    ...session, MultipartUpload: { Parts: valid.sort((a, b) => a.PartNumber - b.PartNumber).map(({ PartNumber, ETag }) => ({ PartNumber, ETag })) },
  }));
  return { ...result, complete: true };
}
