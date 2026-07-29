import { revalidatePath } from "next/cache";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";
import {
  buildPendingUploadObjectKey,
  putObject,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import {
  createUploadedAudioTranscription,
  createUploadedVideoTranscription,
} from "@/lib/transcription-records";
import { SharedOnlyAccessError } from "@/lib/access-errors";
import { normalizeRecordingDurationMs } from "@/lib/recording-duration";
import { titleFromUploadFileName } from "@/lib/upload-titles";
import {
  getUploadMediaFromFile,
  isUploadMediaSizeAllowed,
  MAX_UPLOAD_MEDIA_BYTES,
} from "@/lib/upload-media";
import {
  assertWorkspaceHasProviderCredit,
  providerCreditErrorResponse,
} from "@/lib/provider-credit";
import {
  assertRequestRateLimit,
  requestRateLimitErrorResponse,
  requestRateLimitPolicies,
} from "@/lib/request-rate-limit";

export const runtime = "nodejs";

const uploadStartedAtSchema = z.iso.datetime();

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);
    await assertWorkspaceHasProviderCredit(workspace);
    await assertRequestRateLimit({
      ...requestRateLimitPolicies.serverMediaUpload,
      subject: `${workspace.teamId}:${workspace.userId}`,
    });

    if (isRequestBodyTooLarge(request, MAX_UPLOAD_MEDIA_BYTES + 1_000_000)) {
      return Response.json(
        { error: "Recording file must be 1 GB or smaller" },
        { status: 413 },
      );
    }

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("meeting-audio");
    const startedAt = parseUploadStartedAt(formData?.get("startedAt"));
    const durationMs = normalizeRecordingDurationMs(
      Number(formData?.get("durationMs")),
    );
    const uploadMedia =
      file instanceof File ? getUploadMediaFromFile(file) : null;

    if (
      !(file instanceof File) ||
      file.size === 0 ||
      !uploadMedia ||
      startedAt === null
    ) {
      return Response.json(
        { error: "Invalid audio upload request" },
        { status: 400 },
      );
    }

    if (!isUploadMediaSizeAllowed(file.size)) {
      return Response.json(
        { error: "Recording file must be 1 GB or smaller" },
        { status: 413 },
      );
    }

    const uploadId = crypto.randomUUID();
    const key = buildPendingUploadObjectKey({
      userId: user.id,
      uploadId,
      extension: uploadMedia.extension,
    });
    const body = new Uint8Array(await file.arrayBuffer());

    await putObject({
      key,
      body,
      contentType: uploadMedia.contentType,
    });

    if (uploadMedia.kind === "audio") {
      const transcription = await createUploadedAudioTranscription({
        sessionUser: user,
        objectKey: key,
        title: titleFromUploadFileName(file.name),
        ...(startedAt ? { startedAt } : {}),
        ...(durationMs ? { durationMs } : {}),
        fileSizeBytes: file.size,
        mimeType: uploadMedia.contentType,
      });

      try {
        await inngest.send({
          id: `upload-transcription:${transcription.transcriptJobId}`,
          name: "meeting/transcribe.audio",
          data: { objectKey: key, ...transcription },
        });
      } catch (error) {
        logUploadDispatchDelay(error, transcription.meetingId);
      }

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
      title: titleFromUploadFileName(file.name),
      ...(startedAt ? { startedAt } : {}),
      ...(durationMs ? { durationMs } : {}),
      fileSizeBytes: file.size,
      mimeType: uploadMedia.contentType,
    });

    try {
      await inngest.send({
        id: `upload-video-conversion:${transcription.transcriptJobId}`,
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
    } catch (error) {
      logUploadDispatchDelay(error, transcription.meetingId);
    }

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
    const rateLimitResponse = requestRateLimitErrorResponse(error);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const creditResponse = providerCreditErrorResponse(error);

    if (creditResponse) {
      return creditResponse;
    }

    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid audio upload request" },
        { status: 400 },
      );
    }

    if (error instanceof SharedOnlyAccessError) {
      return Response.json(
        { error: "Shared users cannot add meetings" },
        { status: 403 },
      );
    }

    return Response.json(
      { error: "Audio upload unavailable" },
      { status: 500 },
    );
  }
}

function logUploadDispatchDelay(error: unknown, meetingId: string) {
  console.error("upload_dispatch_delayed", {
    errorMessage: error instanceof Error ? error.message : "Unknown error",
    meetingId,
  });
}

function parseUploadStartedAt(value: FormDataEntryValue | null | undefined) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const result = uploadStartedAtSchema.safeParse(value);

  if (!result.success) {
    return null;
  }

  return new Date(result.data);
}

function isRequestBodyTooLarge(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length"));

  return Number.isFinite(contentLength) && contentLength > maxBytes;
}
