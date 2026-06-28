import { revalidatePath } from "next/cache";

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
import { createUploadedAudioTranscription } from "@/lib/transcription-records";
import { SharedOnlyAccessError } from "@/lib/access-errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("meeting-audio");

  if (!(file instanceof File) || file.size === 0 || !isMp3(file)) {
    return Response.json(
      { error: "Invalid audio upload request" },
      { status: 400 },
    );
  }

  try {
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);

    const uploadId = crypto.randomUUID();
    const key = buildPendingUploadObjectKey({
      userId: user.id,
      uploadId,
      extension: "mp3",
    });
    const body = new Uint8Array(await file.arrayBuffer());

    await putObject({
      key,
      body,
      contentType: "audio/mpeg",
    });

    const transcription = await createUploadedAudioTranscription({
      sessionUser: user,
      objectKey: key,
      title: titleFromFileName(file.name),
      fileSizeBytes: file.size,
      mimeType: "audio/mpeg",
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

function isMp3(file: File) {
  return file.name.toLowerCase().endsWith(".mp3");
}

function titleFromFileName(fileName: string) {
  const title = fileName
    .replace(/\.mp3$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return title || "Uploaded audio";
}
