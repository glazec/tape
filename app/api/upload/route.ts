import { z } from "zod";

import { SharedOnlyAccessError } from "@/lib/access-errors";
import { getCurrentUser } from "@/lib/auth";
import {
  buildPendingUploadObjectKey,
  createUploadUrl,
  UnsafeObjectKeySegmentError,
} from "@/lib/r2";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

export const runtime = "nodejs";

const uploadRequestSchema = z.strictObject({
  extension: z.literal("mp3"),
  contentType: z.literal("audio/mpeg"),
});

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
    const workspace = await getOrCreateWorkspaceForSessionUser(user);
    await assertCanCreateMeetings(workspace);

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

    if (error instanceof SharedOnlyAccessError) {
      return Response.json(
        { error: "Shared users cannot add meetings" },
        { status: 403 },
      );
    }

    return Response.json({ error: "Upload URL unavailable" }, { status: 500 });
  }
}
