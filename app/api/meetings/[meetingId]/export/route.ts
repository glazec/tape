import { exportTranscriptSection, sanitizeFilename } from "@/lib/transcript-export";
import { listReadableMeetingSources } from "@/lib/meeting-composition";
import { currentVisualAssetCondition } from "@/lib/current-audio-asset";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { mediaAssets, meetings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getReadableMeetingsCondition } from "@/lib/meeting-access-policy";
import { buildImageEntryName } from "@/lib/meeting-image-export";
import { createReadUrl } from "@/lib/r2";
import { getOrCreateWorkspaceForSessionUser } from "@/lib/workspace";
import { buildZipArchive, type ZipEntry } from "@/lib/zip";

export const runtime = "nodejs";

const meetingIdSchema = z.uuid();

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

  if (!parsedMeetingId.success) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const format = searchParams.get("format") ?? "text";

  if (format === "mp3") {
    return Response.redirect(
      new URL(
        `/api/meetings/${encodeURIComponent(parsedMeetingId.data)}/audio?download=1`,
        request.url,
      ),
    );
  }

  if (format !== "text" && format !== "images") {
    return Response.json(
      { error: "Unsupported export format" },
      { status: 400 },
    );
  }

  const workspace = await getOrCreateWorkspaceForSessionUser(user, { meetingId });
  const meetingRows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      startedAt: meetings.startedAt,
      createdAt: meetings.createdAt,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.id, parsedMeetingId.data),
        getReadableMeetingsCondition(workspace),
      ),
    )
    .limit(1);
  const meeting = meetingRows[0];

  if (!meeting) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const sources = await listReadableMeetingSources(workspace, meeting.id);
  const exportParts = [meeting, ...sources].sort((a, b) =>
    (a.startedAt ?? a.createdAt)?.getTime() - (b.startedAt ?? b.createdAt)?.getTime());
  if (format === "images") {
    return exportMeetingImages(meeting, exportParts.map(part => part.id));
  }
  const sections: string[] = [];
  for (const [index, part] of exportParts.entries()) {
    const title = exportParts.length > 1 ? `Part ${index + 1}: ${part.title}` : part.title;
    sections.push(await exportTranscriptSection(workspace, part.id, title));
  }
  const filename = `${sanitizeFilename(meeting.title)} transcript.txt`;

  return new Response(sections.join("\n"), {
    headers: {
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function exportMeetingImages(meeting: { id: string; title: string }, sourceIds: string[]) {
  const assets = await db
    .select({
      id: mediaAssets.id,
      mimeType: mediaAssets.mimeType,
      objectKey: mediaAssets.objectKey,
      timestampMs: mediaAssets.timestampMs,
    })
    .from(mediaAssets)
    .where(
      and(
        inArray(mediaAssets.meetingId, sourceIds),
        currentVisualAssetCondition(mediaAssets.meetingId),
        or(
          eq(mediaAssets.type, "screenshot"),
          eq(mediaAssets.type, "video_frame"),
        ),
      ),
    )
    .orderBy(asc(mediaAssets.timestampMs), asc(mediaAssets.createdAt));

  if (assets.length === 0) {
    return Response.json({ error: "Meeting has no images" }, { status: 404 });
  }

  const entries: ZipEntry[] = [];

  for (const [index, asset] of assets.entries()) {
    const response = await fetch(await createReadUrl({ key: asset.objectKey }));

    if (!response.ok) {
      continue;
    }

    entries.push({
      data: new Uint8Array(await response.arrayBuffer()),
      name: buildImageEntryName(index, asset.timestampMs, asset.mimeType),
    });
  }

  if (entries.length === 0) {
    return Response.json(
      { error: "Meeting images could not be exported" },
      { status: 502 },
    );
  }

  return new Response(buildZipArchive(entries), {
    headers: {
      "content-disposition": `attachment; filename="${sanitizeFilename(meeting.title)} images.zip"`,
      "content-type": "application/zip",
    },
  });
}
