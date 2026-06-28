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
  getObjectMetadata,
  ObjectNotFoundError,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import { createUploadedAudioTranscription } from "@/lib/transcription-records";
import { SharedOnlyAccessError } from "@/lib/access-errors";

export const runtime = "nodejs";

const completeUploadSchema = z
  .object({
    uploadId: z.string().min(1),
  })
  .strict();

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const result = completeUploadSchema.safeParse(body);

  if (!result.success) {
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
      extension: "mp3",
    });

    const objectMetadata = await getObjectMetadata({ key });
    const transcription = await createUploadedAudioTranscription({
      sessionUser: user,
      objectKey: key,
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
  } catch (error) {
    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid upload completion request" },
        { status: 400 },
      );
    }

    if (error instanceof ObjectNotFoundError) {
      return Response.json({ error: "Uploaded audio not found" }, { status: 404 });
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
