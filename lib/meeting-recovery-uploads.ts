import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  mediaAssets,
  meetings,
  recordings,
  transcriptJobs,
  transcriptSegments,
} from "@/db/schema";
import { parseManualTranscriptText } from "@/lib/manual-transcript-parser";
import { getManageableMeetingCondition } from "@/lib/meeting-write-policy";
import { parseR2Env } from "@/lib/r2";
import type { WorkspaceContext } from "@/lib/workspace";

export class MeetingRecoveryUploadError extends Error {}

export async function completeMeetingAudioUpload(input: {
  durationMs?: number;
  fileSizeBytes?: number;
  meetingId: string;
  mimeType?: string;
  objectKey: string;
  recordingStartedAt?: Date;
  workspace: WorkspaceContext;
}) {
  await assertCanManageMeeting(input.workspace, input.meetingId);

  const env = parseR2Env(process.env);
  const now = new Date();
  const [recording] = await db
    .insert(recordings)
    .values({
      durationMs: input.durationMs,
      endedAt:
        input.recordingStartedAt && input.durationMs
          ? new Date(input.recordingStartedAt.getTime() + input.durationMs)
          : undefined,
      meetingId: input.meetingId,
      source: "upload",
      startedAt: input.recordingStartedAt,
    })
    .returning({ id: recordings.id });
  const [asset] = await db
    .insert(mediaAssets)
    .values({
      bucket: env.R2_BUCKET,
      fileSizeBytes: input.fileSizeBytes,
      meetingId: input.meetingId,
      recordingId: recording.id,
      mimeType: input.mimeType ?? "audio/mpeg",
      objectKey: input.objectKey,
      source: "upload",
      type: "audio",
    })
    .returning({ id: mediaAssets.id });
  const [job] = await db
    .insert(transcriptJobs)
    .values({
      mediaAssetId: asset.id,
      meetingId: input.meetingId,
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });

  await db
    .update(meetings)
    .set({
      status: "processing",
      updatedAt: now,
    })
    .where(eq(meetings.id, input.meetingId));

  return {
    mediaAssetId: asset.id,
    meetingId: input.meetingId,
    objectKey: input.objectKey,
    recordingId: recording.id,
    transcriptJobId: job.id,
  };
}

export async function completeManualTranscriptUpload(input: {
  meetingId: string;
  transcriptText: string;
  workspace: WorkspaceContext;
}) {
  await assertCanManageMeeting(input.workspace, input.meetingId);

  const segments = parseManualTranscriptText(input.transcriptText);

  if (segments.length === 0) {
    throw new MeetingRecoveryUploadError("Transcript text is empty");
  }

  const now = new Date();
  const [job] = await db
    .insert(transcriptJobs)
    .values({
      meetingId: input.meetingId,
      provider: "manual",
      status: "completed",
    })
    .returning({ id: transcriptJobs.id });

  await db
    .delete(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, input.meetingId));
  await db.insert(transcriptSegments).values(
    segments.map((segment) => ({
      jobId: job.id,
      meetingId: input.meetingId,
      speaker: segment.speaker,
      endMs: segment.endMs,
      startMs: segment.startMs,
      text: segment.text,
    })),
  );
  await db
    .update(meetings)
    .set({
      status: "ready",
      updatedAt: now,
    })
    .where(eq(meetings.id, input.meetingId));

  return {
    meetingId: input.meetingId,
    segmentCount: segments.length,
    transcriptJobId: job.id,
  };
}

export async function assertCanManageMeeting(
  workspace: WorkspaceContext,
  meetingId: string,
) {
  const [meeting] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(getManageableMeetingCondition(workspace, meetingId)))
    .limit(1);

  if (!meeting) {
    throw new MeetingRecoveryUploadError("Meeting not found");
  }
}
