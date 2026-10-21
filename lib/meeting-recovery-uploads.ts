import { randomUUID } from "node:crypto";

import { databaseSql } from "@/db/client";
import { parseManualTranscriptText } from "@/lib/manual-transcript-parser";
import {
  assertCanManageMeeting,
  MeetingRecoveryUploadError,
} from "@/lib/meeting-management";
import { attachUploadedAudioBatch } from "@/lib/meeting-audio-batches";
import type { WorkspaceContext } from "@/lib/workspace";

export {
  assertCanManageMeeting,
  MeetingRecoveryUploadError,
} from "@/lib/meeting-management";

export async function completeMeetingAudioUpload(input: {
  durationMs?: number;
  fileSizeBytes?: number;
  meetingId: string;
  mimeType?: string;
  objectKey: string;
  recordingStartedAt?: Date;
  workspace: WorkspaceContext;
}) {
  const result = await attachUploadedAudioBatch({
    files: [
      {
        durationMs: input.durationMs,
        fileName: "recording",
        fileSizeBytes: input.fileSizeBytes,
        mimeType: input.mimeType ?? "audio/mpeg",
        objectKey: input.objectKey,
      },
    ],
    meetingId: input.meetingId,
    startedAt: input.recordingStartedAt,
    workspace: input.workspace,
  });

  return result.transcriptions[0]!;
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
      delete from meeting_entities
      where meeting_id = ${input.meetingId}::uuid
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
