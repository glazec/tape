import { revalidatePath } from "next/cache";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import {
  completeMeetingAudioUpload,
  MeetingRecoveryUploadError,
} from "@/lib/meeting-recovery-uploads";
import {
  buildPendingUploadObjectKey,
  deleteObject,
  getObjectMetadata,
  ObjectNotFoundError,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import {
  getSupportedUploadMedia,
  isUploadMediaSizeAllowed,
} from "@/lib/upload-media";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { MAX_RECORDING_DURATION_MS } from "@/lib/recording-duration";

export const runtime = "nodejs";

const completeMeetingAudioUploadSchema = z.strictObject({
  uploadId: z.string().min(1),
  extension: z.string().trim().toLowerCase().min(1).default("mp3"),
  contentType: z.string().trim().toLowerCase().min(1).default("audio/mpeg"),
  durationMs: z.number().int().positive().max(MAX_RECORDING_DURATION_MS).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ meetingId }, body] = await Promise.all([
    context.params,
    request.json().catch(() => null),
  ]);
  const result = completeMeetingAudioUploadSchema.safeParse(body);
  const uploadMedia = result.success
    ? getSupportedUploadMedia({
        extension: result.data.extension,
        contentType: result.data.contentType,
      })
    : null;

  if (!result.success || !uploadMedia || uploadMedia.kind !== "audio") {
    return Response.json(
      { error: "Invalid audio upload completion request" },
      { status: 400 },
    );
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    const objectKey = buildPendingUploadObjectKey({
      userId: user.id,
      uploadId: result.data.uploadId,
      extension: uploadMedia.extension,
    });
    const objectMetadata = await getObjectMetadata({ key: objectKey });

    if (!isUploadMediaSizeAllowed(objectMetadata.contentLength)) {
      try {
        await deleteObject({ key: objectKey });
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
        { error: "Invalid audio upload completion request" },
        { status: 400 },
      );
    }

    const transcription = await completeMeetingAudioUpload({
      fileSizeBytes: objectMetadata.contentLength,
      durationMs: result.data.durationMs,
      meetingId,
      mimeType: objectMetadata.contentType,
      objectKey,
      workspace,
    });

    await inngest.send({
      name: "meeting/transcribe.audio",
      data: transcription,
    });

    revalidatePath("/dashboard");
    revalidatePath(`/meetings/${meetingId}`);

    return Response.json(
      {
        queued: true,
        meetingId,
        redirectTo: `/meetings/${meetingId}`,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid audio upload completion request" },
        { status: 400 },
      );
    }

    if (error instanceof ObjectNotFoundError) {
      return Response.json({ error: "Uploaded file not found" }, { status: 404 });
    }

    if (error instanceof MeetingRecoveryUploadError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    return Response.json(
      { error: "Audio upload completion unavailable" },
      { status: 500 },
    );
  }
}
