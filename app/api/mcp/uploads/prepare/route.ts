import { randomUUID } from "node:crypto";

import { z } from "zod";

import { SharedOnlyAccessError } from "@/lib/access-errors";
import {
  mcpBackendAuthErrorResponse,
  verifyMcpBackendRequest,
} from "@/lib/mcp-backend-auth";
import { createMcpUploadToken } from "@/lib/mcp-upload-token";
import {
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse,
} from "@/lib/provider-credit";
import {
  buildPendingUploadObjectKey,
  createUploadUrl,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import { MAX_RECORDING_DURATION_MS } from "@/lib/recording-duration";
import {
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";
import {
  getFileExtension,
  getSupportedUploadMedia,
  isUploadMediaSizeAllowed,
} from "@/lib/upload-media";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const COMPLETION_TOKEN_TTL_SECONDS = 30 * 60;

const prepareUploadSchema = z.strictObject({
  contentType: z.string().trim().toLowerCase().min(1),
  durationMs: z
    .number()
    .int()
    .positive()
    .max(MAX_RECORDING_DURATION_MS)
    .optional(),
  fileName: z.string().trim().min(1).max(512),
  fileSizeBytes: z.number().int().positive(),
  meetingTime: z.iso.datetime(),
  title: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    const { input, user } = verifyMcpBackendRequest(rawBody, request.headers);
    const parsed = prepareUploadSchema.safeParse(input);
    const extension = parsed.success
      ? getFileExtension(parsed.data.fileName)
      : null;
    const uploadMedia =
      parsed.success && extension
        ? getSupportedUploadMedia({
            contentType: parsed.data.contentType,
            extension,
          })
        : null;

    if (
      !parsed.success ||
      !uploadMedia ||
      uploadMedia.kind !== "audio" ||
      !isUploadMediaSizeAllowed(parsed.data.fileSizeBytes)
    ) {
      return Response.json(
        { error: "Invalid meeting upload request" },
        { status: 400 },
      );
    }

    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);
    await assertWorkspaceHasProviderCredit(workspace);
    await assertRequestRateLimit({
      ...requestRateLimitPolicies.serverMediaUpload,
      subject: `${workspace.teamId}:${workspace.userId}`,
    });

    const uploadId = randomUUID();
    const objectKey = buildPendingUploadObjectKey({
      extension: uploadMedia.extension,
      uploadId,
      userId: user.id,
    });
    const uploadUrl = await createUploadUrl({
      contentType: uploadMedia.contentType,
      key: objectKey,
    });
    const issuedAt = Math.floor(Date.now() / 1000);
    const uploadExpiresAt = issuedAt + UPLOAD_URL_TTL_SECONDS;
    const completionToken = createMcpUploadToken({
      authUserId: user.id,
      contentType: uploadMedia.contentType,
      ...(parsed.data.durationMs
        ? { durationMs: parsed.data.durationMs }
        : {}),
      expiresAt: issuedAt + COMPLETION_TOKEN_TTL_SECONDS,
      extension: uploadMedia.extension,
      fileName: parsed.data.fileName,
      fileSizeBytes: parsed.data.fileSizeBytes,
      meetingTime: parsed.data.meetingTime,
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      uploadId,
      userId: workspace.userId,
      version: 1,
    });

    return Response.json({
      completionToken,
      contentType: uploadMedia.contentType,
      expiresAt: new Date(uploadExpiresAt * 1000).toISOString(),
      uploadHeaders: { "Content-Type": uploadMedia.contentType },
      uploadId,
      uploadMethod: "PUT",
      uploadUrl,
    });
  } catch (error) {
    const authResponse = mcpBackendAuthErrorResponse(error);

    if (authResponse) {
      return authResponse;
    }

    const rateLimitResponse = requestRateLimitErrorResponse(error);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (error instanceof SharedOnlyAccessError) {
      return Response.json(
        { error: "Shared users cannot add meetings" },
        { status: 403 },
      );
    }

    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid meeting upload request" },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "Meeting upload preparation unavailable" },
      { status: 500 },
    );
  }
}
