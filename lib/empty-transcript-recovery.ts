import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { meetings, transcriptJobs } from "@/db/schema";
import { getMeetingVocabularyKeyterms } from "@/lib/team-vocabulary";
import { markTranscriptJobFailedSafely } from "@/lib/transcript-job-failure";

export const EMPTY_TRANSCRIPT_RECOVERY_QUEUED =
  "Direct transcription returned no text; chunked recovery queued";

export type EmptyTranscriptRecoveryInput = {
  meetingId: string;
  objectKey?: string;
  recordingId?: string;
  transcriptJobId: string;
};

export function buildEmptyTranscriptRecoveryEvent(
  input: EmptyTranscriptRecoveryInput,
) {
  return {
    id: `empty-transcript-recovery:${input.transcriptJobId}`,
    name: "meeting/recover.empty-transcript" as const,
    data: input,
  };
}

export async function prepareEmptyTranscriptRecovery(
  input: EmptyTranscriptRecoveryInput,
) {
  const result = await db.execute<{
    asset_object_key: string | null;
    external_bot_id: string | null;
    external_recording_id: string | null;
    meeting_bot_id: string | null;
    meeting_recording_id: string | null;
    recording_id: string | null;
  }>(sql`
    select
      media_assets.object_key as asset_object_key,
      recordings.external_bot_id,
      recordings.external_id as external_recording_id,
      meetings.recall_bot_id as meeting_bot_id,
      meetings.recall_recording_id as meeting_recording_id,
      transcript_jobs.recording_id
    from transcript_jobs
    join meetings on meetings.id = transcript_jobs.meeting_id
    left join recordings on recordings.id = transcript_jobs.recording_id
    left join media_assets on media_assets.id = transcript_jobs.media_asset_id
    where transcript_jobs.id = ${input.transcriptJobId}::uuid
      and transcript_jobs.meeting_id = ${input.meetingId}::uuid
      and transcript_jobs.status <> 'completed'
    limit 1
  `);
  const row = result.rows[0];

  if (!row) {
    throw new Error("Transcript job not found for empty transcript recovery");
  }

  const recordingId = input.recordingId ?? row.recording_id ?? undefined;
  const objectKey = input.objectKey ?? row.asset_object_key ?? undefined;
  const recallRecordingId =
    row.external_recording_id ?? row.meeting_recording_id ?? undefined;
  const recallBotId = row.external_bot_id ?? row.meeting_bot_id ?? undefined;

  if (!objectKey && !recallBotId && !recallRecordingId) {
    throw new Error("Recording source is unavailable for transcript recovery");
  }

  const keyterms = await getMeetingVocabularyKeyterms(input.meetingId);
  const now = new Date();

  await db
    .update(transcriptJobs)
    .set({
      errorMessage: EMPTY_TRANSCRIPT_RECOVERY_QUEUED,
      status: "running",
      updatedAt: now,
    })
    .where(
      and(
        eq(transcriptJobs.id, input.transcriptJobId),
        eq(transcriptJobs.meetingId, input.meetingId),
        ne(transcriptJobs.status, "completed"),
      ),
    );
  await db
    .update(meetings)
    .set({ status: "processing", updatedAt: now })
    .where(
      and(
        eq(meetings.id, input.meetingId),
        inArray(meetings.status, ["processing", "failed", "missed"]),
      ),
    );

  return {
    ...(objectKey ? { objectKey } : {}),
    keyterms,
    meetingId: input.meetingId,
    ...(recallBotId ? { recallBotId } : {}),
    ...(recallRecordingId ? { recallRecordingId } : {}),
    ...(recordingId ? { recordingId } : {}),
    transcriptJobId: input.transcriptJobId,
  };
}

export async function markEmptyTranscriptRecoveryFailed(input: {
  error: unknown;
  meetingId: string;
  transcriptJobId: string;
}) {
  const errorMessage =
    input.error instanceof Error && input.error.message.trim()
      ? input.error.message
      : "Empty transcript recovery failed";

  return markTranscriptJobFailedSafely({
    errorMessage,
    meetingId: input.meetingId,
    transcriptJobId: input.transcriptJobId,
  });
}

export function shouldRecoverEmptyTranscript(input: {
  errorMessage?: string;
  providerJobId?: string;
}) {
  return (
    input.errorMessage === "No transcript text returned" &&
    !input.providerJobId?.startsWith("chunks:") &&
    !input.providerJobId?.startsWith("split:")
  );
}
