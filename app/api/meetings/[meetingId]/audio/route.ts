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
  request: Request,
  context: { params: Promise<{ meetingId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { meetingId } = await context.params;
  const parsedMeetingId = meetingIdSchema.safeParse(meetingId);
  const searchParams = new URL(request.url).searchParams;
  const shouldDownload = searchParams.get("download") === "1";
  const shouldProxy = searchParams.get("proxy") === "1" || shouldDownload;

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const rows = await db
    .select({
      title: meetings.title,
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
  const meeting = rows[0];
  const objectKey = meeting?.objectKey;
  const downloadFilename = shouldDownload
    ? `${sanitizeFilename(meeting?.title ?? "meeting")} audio.mp3`
    : undefined;

  if (objectKey) {
    const audioUrl = await createReadUrl({ key: objectKey });

    return shouldProxy
      ? proxyAudio(audioUrl, downloadFilename)
      : Response.redirect(audioUrl);
  }

  const recallBotId = meeting?.recallBotId;

  if (recallBotId) {
    const bot = await retrieveRecallBot(recallBotId);
    const audioUrl = findRecallRecordingMediaUrl(
      bot,
      meeting.recallRecordingId,
    );

    if (audioUrl) {
      return shouldProxy
        ? proxyAudio(audioUrl, downloadFilename)
        : Response.redirect(audioUrl);
    }
  }

  return Response.json({ error: "Audio not found" }, { status: 404 });
}

async function proxyAudio(audioUrl: string, filename?: string) {
  const response = await fetch(audioUrl);

  if (!response.ok || !response.body) {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "cache-control": "private, max-age=300",
    "content-type": response.headers.get("content-type") ?? "audio/mpeg",
  };

  if (filename) {
    headers["content-disposition"] = `attachment; filename="${filename}"`;
  }

  return new Response(response.body, {
    headers,
  });
}

function sanitizeFilename(value: string) {
  return (
    value
      .replace(/[^\w .()[\]]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "meeting"
  );
}
