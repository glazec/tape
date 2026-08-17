import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { getMcpBackendSharedSecret } from "@/lib/mcp-backend-auth";
import { MAX_RECORDING_DURATION_MS } from "@/lib/recording-duration";
import { MAX_UPLOAD_MEDIA_BYTES } from "@/lib/upload-media";

const uploadTokenSchema = z.strictObject({
  authUserId: z.string().trim().min(1).max(512),
  contentType: z.string().trim().toLowerCase().min(1),
  durationMs: z
    .number()
    .int()
    .positive()
    .max(MAX_RECORDING_DURATION_MS)
    .optional(),
  expiresAt: z.number().int().positive(),
  extension: z.string().trim().toLowerCase().min(1),
  fileName: z.string().trim().min(1).max(512),
  fileSizeBytes: z.number().int().positive().max(MAX_UPLOAD_MEDIA_BYTES),
  meetingTime: z.iso.datetime(),
  title: z.string().trim().min(1).max(200).optional(),
  uploadId: z.uuid(),
  userId: z.uuid(),
  version: z.literal(1),
});

export type McpUploadTokenPayload = z.infer<typeof uploadTokenSchema>;

export class McpUploadTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpUploadTokenError";
  }
}

export function createMcpUploadToken(payload: McpUploadTokenPayload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signEncodedPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function parseMcpUploadToken(token: string) {
  const [encodedPayload, providedSignature, extra] = token.split(".");

  if (!encodedPayload || !providedSignature || extra) {
    throw new McpUploadTokenError("Invalid meeting upload token");
  }

  const expectedBytes = Buffer.from(signEncodedPayload(encodedPayload));
  const providedBytes = Buffer.from(providedSignature);

  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new McpUploadTokenError("Invalid meeting upload token");
  }

  let payload: unknown;

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    throw new McpUploadTokenError("Invalid meeting upload token");
  }

  const parsed = uploadTokenSchema.safeParse(payload);

  if (!parsed.success || parsed.data.expiresAt < Math.floor(Date.now() / 1000)) {
    throw new McpUploadTokenError("Meeting upload token expired or invalid");
  }

  return parsed.data;
}

function signEncodedPayload(encodedPayload: string) {
  return createHmac("sha256", getMcpBackendSharedSecret())
    .update(`tape-mcp-upload.v1.${encodedPayload}`)
    .digest("base64url");
}
