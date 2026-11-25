import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaAssets } from "@/db/schema";
import { deleteObject, deleteObjectsUnderPrefix, meetingNoteImagesPrefix, parseR2Env } from "@/lib/r2";

export async function deleteMeetingMediaObjects(meetingId: string) {
  const env = parseR2Env(process.env);
  const assets = await db
    .select({ objectKey: mediaAssets.objectKey })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.meetingId, meetingId),
        eq(mediaAssets.bucket, env.R2_BUCKET),
      ),
    );

  const noteImageCount = await deleteObjectsUnderPrefix(meetingNoteImagesPrefix(meetingId));
  await Promise.all(
    assets.map(({ objectKey }) => deleteObject({ key: objectKey })),
  );

  return { deletedObjectCount: assets.length + noteImageCount };
}
