import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { mediaAssets, meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import { createReadUrl } from "@/lib/r2";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const idSchema = z.uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string; meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assetId, meetingId } = await context.params;
  const parsedMeetingId = idSchema.safeParse(meetingId);
  const parsedAssetId = idSchema.safeParse(assetId);

  if (!parsedMeetingId.success || !parsedAssetId.success) {
    return Response.json({ error: "Image not found" }, { status: 404 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const rows = await db
    .select({
      objectKey: mediaAssets.objectKey,
    })
    .from(mediaAssets)
    .innerJoin(meetings, eq(meetings.id, mediaAssets.meetingId))
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(mediaAssets.id, parsedAssetId.data),
        or(eq(mediaAssets.type, "screenshot"), eq(mediaAssets.type, "video_frame")),
        getReadableMeetingsCondition(workspace),
      ),
    )
    .orderBy(desc(mediaAssets.createdAt))
    .limit(1);
  const asset = rows[0];

  if (!asset) {
    return Response.json({ error: "Image not found" }, { status: 404 });
  }

  return Response.redirect(await createReadUrl({ key: asset.objectKey }));
}
