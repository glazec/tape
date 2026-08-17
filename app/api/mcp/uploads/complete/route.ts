import { revalidatePath } from "next/cache";

import { z } from "zod";

import { SharedOnlyAccessError } from "@/lib/access-errors";
import { dispatchAudioBatchTranscriptions } from "@/lib/audio-batch-dispatch";
import {
  mcpBackendAuthErrorResponse,
  verifyMcpBackendRequest,
} from "@/lib/mcp-backend-auth";
import {
  McpUploadTokenError,
  parseMcpUploadToken,
} from "@/lib/mcp-upload-token";
import {
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse,
} from "@/lib/provider-credit";
import {
  buildPendingUploadObjectKey,
  deleteObject,
  getObjectMetadata,
  ObjectNotFoundError,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import { createUploadedAudioBatch } from "@/lib/meeting-audio-batches";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

const completeUploadSchema = z.strictObject({
  completionToken: z.string().min(1).max(4096),
});

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    const { input, user } = verifyMcpBackendRequest(rawBody, request.headers);
    const parsed = completeUploadSchema.safeParse(input);

    if (!parsed.success) {
      return Response.json(
        { error: "Invalid meeting upload completion" },
        { status: 400 },
      );
    }

    const upload = parseMcpUploadToken(parsed.data.completionToken);
    const workspace = await getOrCreateWorkspaceForSessionUser(user);

    if (
      upload.authUserId !== user.id ||
      upload.userId !== workspace.userId
    ) {
      return Response.json(
        { error: "Meeting upload does not belong to this user" },
        { status: 403 },
      );
    }

    await assertCanCreateMeetings(workspace);
    await assertWorkspaceHasProviderCredit(workspace);

    const objectKey = buildPendingUploadObjectKey({
      extension: upload.extension,
      uploadId: upload.uploadId,
      userId: user.id,
    });
    const metadata = await getObjectMetadata({ key: objectKey });

    if (metadata.contentLength !== upload.fileSizeBytes) {
      try {
        await deleteObject({ key: objectKey });
      } catch {
        // Reject a partial or substituted upload even if cleanup is unavailable.
      }

      return Response.json(
        { error: "Uploaded file size does not match the local recording" },
        { status: 400 },
      );
    }

    if (
      metadata.contentType &&
      metadata.contentType.toLowerCase() !== upload.contentType
    ) {
      try {
        await deleteObject({ key: objectKey });
      } catch {
        // Reject a substituted upload even if cleanup is unavailable.
      }

      return Response.json(
        { error: "Uploaded file type does not match the meeting upload" },
        { status: 400 },
      );
    }

    const result = await createUploadedAudioBatch({
      files: [
        {
          ...(upload.durationMs ? { durationMs: upload.durationMs } : {}),
          fileName: upload.fileName,
          fileSizeBytes: metadata.contentLength,
          mimeType: metadata.contentType ?? upload.contentType,
          objectKey,
        },
      ],
      startedAt: new Date(upload.meetingTime),
      title: upload.title ?? upload.fileName.replace(/\.[^.]+$/, ""),
      workspace,
    });
    const dispatch = await dispatchAudioBatchTranscriptions(
      result.transcriptions,
    );

    revalidatePath("/dashboard");
    revalidatePath(`/meetings/${result.meetingId}`);

    return Response.json(
      {
        delayedCount: dispatch.delayedCount,
        existing: result.existing,
        meetingId: result.meetingId,
        queued: true,
        redirectTo: `/meetings/${result.meetingId}`,
        status: "processing",
      },
      { status: 202 },
    );
  } catch (error) {
    const authResponse = mcpBackendAuthErrorResponse(error);

    if (authResponse) {
      return authResponse;
    }

    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (error instanceof McpUploadTokenError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof ObjectNotFoundError) {
      return Response.json({ error: "Uploaded file not found" }, { status: 404 });
    }

    if (error instanceof SharedOnlyAccessError) {
      return Response.json(
        { error: "Shared users cannot add meetings" },
        { status: 403 },
      );
    }

    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid meeting upload completion" },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "Meeting upload completion unavailable" },
      { status: 500 },
    );
  }
}
