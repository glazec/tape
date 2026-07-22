import { z } from "zod";
import { revalidatePath } from "next/cache";

import { inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";
import {
  buildPendingUploadObjectKey,
  deleteObject,
  getObjectMetadata,
  ObjectNotFoundError,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import {
  createUploadedAudioTranscription,
  createUploadedVideoTranscription,
} from "@/lib/transcription-records";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import {
  MAX_RECORDING_DURATION_MS,
  normalizeRecordingDurationMs,
} from "@/lib/recording-duration";
import { titleFromUploadFileName } from "@/lib/upload-titles";
import {
  getSupportedUploadMedia,
  isUploadMediaSizeAllowed,
} from "@/lib/upload-media";

export const runtime = "nodejs";

const completeUploadSchema = z.strictObject({
  uploadId: z.string().min(1),
  extension: z.string().trim().toLowerCase().min(1).default("mp3"),
  contentType: z.string().trim().toLowerCase().min(1).default("audio/mpeg"),
  fileName: z.string().optional(),
  durationMs: z.number().int().positive().max(MAX_RECORDING_DURATION_MS).optional(),
  startedAt: z.iso.datetime().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const result = completeUploadSchema.safeParse(body);
  const uploadMedia = result.success
    ? getSupportedUploadMedia({
        extension: result.data.extension,
        contentType: result.data.contentType,
      })
    : null;

  if (!result.success || !uploadMedia) {
    return Response.json(
      { error: "Invalid upload completion request" },
      { status: 400 },
    );
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);

    const key = buildPendingUploadObjectKey({
      userId: user.id,
      uploadId: result.data.uploadId,
      extension: uploadMedia.extension,
    });

    const objectMetadata = await getObjectMetadata({ key });
    if (!isUploadMediaSizeAllowed(objectMetadata.contentLength)) {
      try {
        await deleteObject({ key });
      } catch {
        // Reject the upload even when best-effort object cleanup is unavailable.
      }
      return Response.json(
        { error: "Recording file must be 1 GB or smaller" },
        { status: 413 },
      );
    }

    if (
      objectMetadata.contentType &&
      objectMetadata.contentType.toLowerCase() !== uploadMedia.contentType
    ) {
      return Response.json(
        { error: "Invalid upload completion request" },
        { status: 400 },
      );
    }

    const title = result.data.fileName
      ? titleFromUploadFileName(result.data.fileName)
      : undefined;
    const startedAt = result.data.startedAt
      ? new Date(result.data.startedAt)
      : undefined;
    const durationMs = normalizeRecordingDurationMs(result.data.durationMs);
    if (uploadMedia.kind === "audio") {
      const transcription = await createUploadedAudioTranscription({
        sessionUser: user,
        objectKey: key,
        ...(title ? { title } : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(durationMs ? { durationMs } : {}),
        fileSizeBytes: objectMetadata.contentLength,
        mimeType: objectMetadata.contentType,
      });

      await inngest.send({
        name: "meeting/transcribe.audio",
        data: { objectKey: key, ...transcription },
      });

      revalidatePath("/dashboard");

      return Response.json(
        {
          queued: true,
          key,
          meetingId: transcription.meetingId,
          redirectTo: "/dashboard",
        },
        { status: 202 },
      );
    }

    const transcription = await createUploadedVideoTranscription({
      sessionUser: user,
      objectKey: key,
      ...(title ? { title } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(durationMs ? { durationMs } : {}),
      fileSizeBytes: objectMetadata.contentLength,
      mimeType: objectMetadata.contentType,
    });

    await inngest.send({
      name: "meeting/convert.video-to-audio",
      data: {
        meetingId: transcription.meetingId,
        sourceMediaAssetId: transcription.sourceMediaAssetId,
        sourceObjectKey: key,
        audioMediaAssetId: transcription.audioMediaAssetId,
        audioObjectKey: transcription.audioObjectKey,
        transcriptJobId: transcription.transcriptJobId,
        recordingId: transcription.recordingId,
      },
    });

    revalidatePath("/dashboard");

    return Response.json(
      {
        queued: true,
        key,
        meetingId: transcription.meetingId,
        redirectTo: "/dashboard",
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid upload completion request" },
        { status: 400 },
      );
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

    return Response.json(
      { error: "Upload completion unavailable" },
      { status: 500 },
    );
  }
}
