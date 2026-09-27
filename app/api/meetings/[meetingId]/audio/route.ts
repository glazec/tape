import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { mediaAssets, meetings, recordings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import { createReadUrl } from "@/lib/r2";
import {
  findRecallRecordingMediaUrl,
  retrieveRecallBot,
  retrieveRecallRecording,
} from "@/lib/vendors/recall";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();
const recordingIdSchema = z.uuid();

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
  const requestedRecordingId = searchParams.get("recording");
  const shouldDownload = searchParams.get("download") === "1";
  const shouldProxy = searchParams.get("proxy") === "1" || shouldDownload;

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }

  const parsedRecordingId = requestedRecordingId
    ? recordingIdSchema.safeParse(requestedRecordingId)
    : null;

  if (parsedRecordingId && !parsedRecordingId.success) {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user);
  const rows = parsedRecordingId?.success
    ? await db
        .select({
          title: meetings.title,
          objectKey: mediaAssets.objectKey,
          recallBotId: recordings.externalBotId,
          recallRecordingId: recordings.externalId,
        })
        .from(meetings)
        .innerJoin(
          recordings,
          and(
            eq(recordings.id, parsedRecordingId.data),
            eq(recordings.meetingId, meetings.id),
          ),
        )
        .leftJoin(
          mediaAssets,
          and(
            eq(mediaAssets.recordingId, recordings.id),
            or(
              eq(mediaAssets.type, "synthesized_audio"),
              eq(mediaAssets.type, "audio"),
            ),
          ),
        )
        .where(
          and(
            eq(meetings.id, parsedMeetingId.data),
            getReadableMeetingsCondition(workspace),
          ),
        )
        .orderBy(
          desc(
            sql`case when ${mediaAssets.type} = 'synthesized_audio' then 1 else 0 end`,
          ),
          desc(mediaAssets.createdAt),
        )
        .limit(1)
    : await db
        .select({
          title: meetings.title,
          objectKey: mediaAssets.objectKey,
          recallBotId: meetings.recallBotId,
          recallRecordingId: meetings.recallRecordingId,
        })
        .from(meetings)
        .leftJoin(
          mediaAssets,
          and(
            eq(mediaAssets.meetingId, meetings.id),
            or(
              eq(mediaAssets.type, "synthesized_audio"),
              eq(mediaAssets.type, "audio"),
            ),
          ),
        )
        .where(
          and(
            eq(meetings.id, parsedMeetingId.data),
            getReadableMeetingsCondition(workspace),
          ),
        )
        .orderBy(
          desc(
            sql`case when ${mediaAssets.type} = 'synthesized_audio' then 1 else 0 end`,
          ),
          desc(mediaAssets.createdAt),
        )
        .limit(1);
  const meeting = rows[0];
  const objectKey = meeting?.objectKey;
  const downloadFilename = shouldDownload
    ? `${sanitizeFilename(meeting?.title ?? "meeting")} audio.mp3`
    : undefined;

  if (objectKey) {
    const audioUrl = await createReadUrl({ key: objectKey });

    return shouldProxy
      ? proxyAudio(request, audioUrl, downloadFilename)
      : Response.redirect(audioUrl);
  }

  const recallAudioUrl = await resolveRecallAudioUrl({
    recallBotId: meeting?.recallBotId ?? null,
    recallRecordingId: meeting?.recallRecordingId ?? null,
  });

  if (recallAudioUrl) {
    return shouldProxy
      ? proxyAudio(request, recallAudioUrl, downloadFilename)
      : Response.redirect(recallAudioUrl);
  }

  return Response.json({ error: "Audio not found" }, { status: 404 });
}

async function resolveRecallAudioUrl(input: {
  recallBotId: string | null;
  recallRecordingId: string | null;
}) {
  if (input.recallBotId) {
    try {
      const bot = await retrieveRecallBot(input.recallBotId);
      const audioUrl = findRecallRecordingMediaUrl(
        bot,
        input.recallRecordingId,
      );

      if (audioUrl) {
        return audioUrl;
      }
    } catch (error) {
      if (!input.recallRecordingId) {
        throw error;
      }
    }
  }

  if (!input.recallRecordingId) {
    return null;
  }

  const recording = await retrieveRecallRecording(input.recallRecordingId);

  return findRecallRecordingMediaUrl(recording, input.recallRecordingId);
}

async function proxyAudio(request: Request, audioUrl: string, filename?: string) {
  const upstreamHeaders = new Headers();

  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  const response = await fetch(audioUrl, {
    headers: upstreamHeaders,
    cache: "no-store",
    signal: request.signal,
  });

  if (response.status === 416) {
    const headers = new Headers({ "cache-control": "private, no-store" });
    const contentRange = response.headers.get("content-range");
    if (contentRange) headers.set("content-range", contentRange);
    await response.body?.cancel();
    return new Response(null, { status: 416, headers });
  }

  if (!response.ok || !response.body) {
    return Response.json({ error: "Audio not found" }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "cache-control": "private, no-store",
    "content-type": response.headers.get("content-type") ?? "audio/mpeg",
  };

  for (const name of [
    "accept-ranges",
    "content-range",
    "content-length",
    "etag",
    "last-modified",
  ]) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }

  if (filename) {
    headers["content-disposition"] = `attachment; filename="${filename}"`;
  }

  return new Response(response.body, {
    status: response.status,
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
