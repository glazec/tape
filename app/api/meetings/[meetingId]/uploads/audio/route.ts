import { revalidatePath } from "next/cache";

import { inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import {
  assertCanManageMeeting,
  completeMeetingAudioUpload,
  MeetingRecoveryUploadError,
} from "@/lib/meeting-recovery-uploads";
import {
  buildPendingUploadObjectKey,
  putObject,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import {
  getUploadMediaFromFile,
  isUploadMediaSizeAllowed,
} from "@/lib/upload-media";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { normalizeRecordingDurationMs } from "@/lib/recording-duration";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { meetingId } = await context.params;
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanManageMeeting(workspace, meetingId);
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("meeting-audio");
    const durationMs = normalizeRecordingDurationMs(
      Number(formData?.get("durationMs")),
    );
    const recordingStartedAtValue = formData?.get("recordingStartedAt");
    const recordingStartedAt =
      typeof recordingStartedAtValue === "string" && recordingStartedAtValue
        ? new Date(recordingStartedAtValue)
        : undefined;
    const uploadMedia =
      file instanceof File ? getUploadMediaFromFile(file) : null;

    if (
      !(file instanceof File) ||
      file.size === 0 ||
      uploadMedia?.kind !== "audio"
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
    const objectKey = buildPendingUploadObjectKey({
      userId: user.id,
      uploadId,
      extension: uploadMedia.extension,
    });
    const body = new Uint8Array(await file.arrayBuffer());

    await putObject({
      key: objectKey,
      body,
      contentType: uploadMedia.contentType,
    });

    const transcription = await completeMeetingAudioUpload({
      fileSizeBytes: file.size,
      durationMs,
      ...(recordingStartedAt && !Number.isNaN(recordingStartedAt.getTime())
        ? { recordingStartedAt }
        : {}),
      meetingId,
      mimeType: uploadMedia.contentType,
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
        key: objectKey,
        meetingId,
        redirectTo: `/meetings/${meetingId}`,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid audio upload request" },
        { status: 400 },
      );
    }

    if (error instanceof MeetingRecoveryUploadError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    return Response.json(
      { error: "Audio upload unavailable" },
      { status: 500 },
    );
  }
}
