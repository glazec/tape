import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { databaseSql, db } from "@/db/client";
import {
  mediaAssets,
  meetings,
  recordings,
  transcriptJobs,
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
  const transcriptJobId = randomUUID();
  const segmentRows = segments.map((segment) => ({
    end_ms: segment.endMs ?? null,
    speaker: segment.speaker,
    start_ms: segment.startMs,
    text: segment.text,
  }));

  await databaseSql.transaction((txn) => [
    txn`
      insert into transcript_jobs (
        id,
        meeting_id,
        provider,
        status,
        created_at,
        updated_at
      )
      values (
        ${transcriptJobId}::uuid,
        ${input.meetingId}::uuid,
        'manual',
        'completed',
        ${now},
        ${now}
      )
    `,
    txn`
      delete from transcript_segments
      where meeting_id = ${input.meetingId}::uuid
    `,
    txn`
      insert into transcript_segments (
        meeting_id,
        job_id,
        speaker,
        start_ms,
        end_ms,
        text
      )
      select
        ${input.meetingId}::uuid,
        ${transcriptJobId}::uuid,
        segment.speaker,
        segment.start_ms,
        segment.end_ms,
        segment.text
      from jsonb_to_recordset(${JSON.stringify(segmentRows)}::jsonb) as segment(
        speaker text,
        start_ms integer,
        end_ms integer,
        text text
      )
    `,
    txn`
      update meetings
      set status = 'ready', updated_at = ${now}
      where id = ${input.meetingId}::uuid
    `,
  ]);

  return {
    meetingId: input.meetingId,
    segmentCount: segments.length,
    transcriptJobId,
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
