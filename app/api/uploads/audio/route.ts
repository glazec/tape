import { inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import {
  buildPendingUploadObjectKey,
  putObject,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";

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

    await inngest.send({
      name: "meeting/transcribe.audio",
      data: { objectKey: key },
    });

    return Response.json({ queued: true, key }, { status: 202 });
  } catch (error) {
    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid audio upload request" },
        { status: 400 },
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
