import {
  and,
  asc,
  eq,
  gte,
  isNull,
  or,
} from "drizzle-orm";

import { db } from "@/db/client";
import { mediaAssets, meetings, transcriptJobs } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { buildMeetingObjectKey } from "@/lib/r2";

const UPLOAD_DISPATCH_RETRY_WINDOW_MS = 6 * 60 * 60 * 1_000;
const UPLOAD_DISPATCH_BATCH_SIZE = 100;

export async function dispatchQueuedUploadTranscriptions(
  input: { now?: Date } = {},
) {
  const now = input.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - UPLOAD_DISPATCH_RETRY_WINDOW_MS,
  );
  const rows = await db
    .select({
      meetingId: transcriptJobs.meetingId,
      mediaAssetId: transcriptJobs.mediaAssetId,
      recordingId: transcriptJobs.recordingId,
      sourceMediaAssetId: mediaAssets.id,
      sourceObjectKey: mediaAssets.objectKey,
      sourceType: mediaAssets.type,
      teamId: meetings.teamId,
      transcriptJobId: transcriptJobs.id,
    })
    .from(transcriptJobs)
    .innerJoin(meetings, eq(meetings.id, transcriptJobs.meetingId))
    .leftJoin(
      mediaAssets,
      or(
        eq(mediaAssets.id, transcriptJobs.mediaAssetId),
        and(
          isNull(transcriptJobs.mediaAssetId),
          eq(mediaAssets.recordingId, transcriptJobs.recordingId),
          eq(mediaAssets.type, "transcript_source"),
        ),
      ),
    )
    .where(
      and(
        or(eq(meetings.platform, "upload"), eq(mediaAssets.source, "upload")),
        eq(transcriptJobs.provider, "elevenlabs"),
        eq(transcriptJobs.status, "queued"),
        isNull(transcriptJobs.providerJobId),
        gte(transcriptJobs.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(transcriptJobs.createdAt))
    .limit(UPLOAD_DISPATCH_BATCH_SIZE);
  const seenJobIds = new Set<string>();
  let dispatchedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    if (seenJobIds.has(row.transcriptJobId)) {
      continue;
    }

    seenJobIds.add(row.transcriptJobId);
    const event = buildQueuedUploadEvent(row);

    if (!event) {
      skippedCount += 1;
      continue;
    }

    try {
      await inngest.send(event);
      dispatchedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    dispatchedCount,
    failedCount,
    skippedCount,
  };
}

function buildQueuedUploadEvent(row: {
  meetingId: string;
  mediaAssetId: string | null;
  recordingId: string | null;
  sourceMediaAssetId: string | null;
  sourceObjectKey: string | null;
  sourceType: string | null;
  teamId: string;
  transcriptJobId: string;
}) {
  if (!row.sourceMediaAssetId || !row.sourceObjectKey) {
    return null;
  }

  if (row.mediaAssetId && row.sourceType === "audio") {
    return {
      id: `upload-transcription:${row.transcriptJobId}`,
      name: "meeting/transcribe.audio" as const,
      data: {
        meetingId: row.meetingId,
        mediaAssetId: row.mediaAssetId,
        objectKey: row.sourceObjectKey,
        ...(row.recordingId ? { recordingId: row.recordingId } : {}),
        transcriptJobId: row.transcriptJobId,
      },
    };
  }

  if (!row.mediaAssetId && row.sourceType === "transcript_source") {
    const audioMediaAssetId = row.transcriptJobId;

    return {
      id: `upload-video-conversion:${row.transcriptJobId}`,
      name: "meeting/convert.video-to-audio" as const,
      data: {
        audioMediaAssetId,
        audioObjectKey: buildMeetingObjectKey({
          assetId: audioMediaAssetId,
          extension: "mp3",
          meetingId: row.meetingId,
          teamId: row.teamId,
        }),
        meetingId: row.meetingId,
        ...(row.recordingId ? { recordingId: row.recordingId } : {}),
        sourceMediaAssetId: row.sourceMediaAssetId,
        sourceObjectKey: row.sourceObjectKey,
        transcriptJobId: row.transcriptJobId,
      },
    };
  }

  return null;
}
