import { z } from "zod";

import { inngest } from "@/inngest/client";
import { getCurrentUser } from "@/lib/auth";
import {
  buildPendingUploadObjectKey,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";

export const runtime = "nodejs";

const completeUploadSchema = z.object({
  uploadId: z.string().min(1),
}).strict();

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
    const key = buildPendingUploadObjectKey({
      userId: user.id,
      uploadId: result.data.uploadId,
      extension: "mp3",
    });

    await inngest.send({
      name: "meeting/transcribe.audio",
      data: { objectKey: key },
    });

    return Response.json({ queued: true, key }, { status: 202 });
  } catch (error) {
    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid upload completion request" },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "Upload completion unavailable" },
      { status: 500 },
    );
  }
}
