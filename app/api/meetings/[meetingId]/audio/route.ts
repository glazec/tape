import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { mediaAssets, meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { createReadUrl } from "@/lib/r2";
import {
  findRecallRecordingMediaUrl,
  retrieveRecallBot,
} from "@/lib/vendors/recall";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId } = await context.params;
  const parsedMeetingId = meetingIdSchema.safeParse(meetingId);

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const rows = await db
    .select({
      objectKey: mediaAssets.objectKey,
      recallBotId: meetings.recallBotId,
      recallRecordingId: meetings.recallRecordingId,
    })
    .from(meetings)
    .leftJoin(
      mediaAssets,
      and(eq(mediaAssets.meetingId, meetings.id), eq(mediaAssets.type, "audio")),
    )
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        eq(meetings.teamId, workspace.teamId),
      ),
    )
    .orderBy(desc(mediaAssets.createdAt))
    .limit(1);
  const objectKey = rows[0]?.objectKey;

  if (objectKey) {
    return Response.redirect(await createReadUrl({ key: objectKey }));
  }

  const recallBotId = rows[0]?.recallBotId;

  if (recallBotId) {
    const bot = await retrieveRecallBot(recallBotId);
    const audioUrl = findRecallRecordingMediaUrl(
      bot,
      rows[0].recallRecordingId,
    );

    if (audioUrl) {
      return Response.redirect(audioUrl);
    }
  }

  return Response.json({ error: "Audio not found" }, { status: 404 });
}
