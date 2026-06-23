import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import {
  buildPendingUploadObjectKey,
  createUploadUrl,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";

export const runtime = "nodejs";

const uploadRequestSchema = z
  .object({
    extension: z.literal("mp3"),
    contentType: z.literal("audio/mpeg"),
  })
  .strict();

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const result = uploadRequestSchema.safeParse(body);

  if (!result.success) {
    return Response.json({ error: "Invalid upload request" }, { status: 400 });
  }

  try {
    const uploadId = crypto.randomUUID();
    const key = buildPendingUploadObjectKey({
      userId: user.id,
      uploadId,
      extension: result.data.extension,
    });
    const uploadUrl = await createUploadUrl({
      key,
      contentType: result.data.contentType,
    });

    return Response.json({ key, uploadUrl, uploadId });
  } catch (error) {
    if (error instanceof UnsafeObjectKeySegmentError) {
      return Response.json(
        { error: "Invalid upload request" },
        { status: 400 },
      );
    }

    return Response.json({ error: "Upload URL unavailable" }, { status: 500 });
  }
}
