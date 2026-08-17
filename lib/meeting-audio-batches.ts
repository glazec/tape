import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";

import { databaseSql, db } from "@/db/client";
import {
  mediaAssets,
  meetingEntities,
  meetings,
  transcriptJobs,
} from "@/db/schema";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
import { assertCanManageMeeting } from "@/lib/meeting-recovery-uploads";
import { parseR2Env } from "@/lib/r2";
import type { WorkspaceContext } from "@/lib/workspace";

export type CompletedAudioBatchFile = {
  durationMs: number;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  objectKey: string;
};

export type AudioBatchTranscription = {
  mediaAssetId: string;
  meetingId: string;
  objectKey: string;
  recordingId: string;
  transcriptJobId: string;
};

export async function createUploadedAudioBatch(input: {
  files: CompletedAudioBatchFile[];
  startedAt: Date;
  title: string;
  workspace: WorkspaceContext;
}) {
  const existing = await findExistingAudioBatch(
    input.files.map((file) => file.objectKey),
  );

  if (existing) {
    await assertCanManageMeeting(input.workspace, existing.meetingId);
    return existing;
  }

  const meetingId = randomUUID();
  const transcriptions = buildAudioBatchRows({
    files: input.files,
    meetingId,
    modeForIndex: (index) => (index === 0 ? "replace" : "append"),
    startedAt: input.startedAt,
  });

  await databaseSql.transaction((txn) => [
    txn`
      insert into meetings (
        id,
        team_id,
        owner_user_id,
        title,
        title_source,
        platform,
        status,
        started_at
      )
      values (
        ${meetingId}::uuid,
        ${input.workspace.teamId}::uuid,
        ${input.workspace.userId}::uuid,
        ${input.title},
        'upload',
        'upload',
        'processing',
        ${input.startedAt}
      )
    `,
    ...buildAudioBatchInsertQueries(txn, transcriptions),
  ]);

  try {
    await reconcileMeetingSharingForMeeting(meetingId);
  } catch (error) {
    await db.delete(meetings).where(eq(meetings.id, meetingId));
    throw error;
  }

  return { meetingId, transcriptions };
}

export async function attachUploadedAudioBatch(input: {
  files: CompletedAudioBatchFile[];
  meetingId: string;
  startedAt: Date;
  workspace: WorkspaceContext;
}) {
  await assertCanManageMeeting(input.workspace, input.meetingId);
  const existing = await findExistingAudioBatch(
    input.files.map((file) => file.objectKey),
    input.meetingId,
  );

  if (existing) {
    return existing;
  }

  const transcriptions = buildAudioBatchRows({
    files: input.files,
    meetingId: input.meetingId,
    modeForIndex: (index) => (index === 0 ? "replace" : "append"),
    startedAt: input.startedAt,
  });
  const now = new Date();

  await databaseSql.transaction((txn) => [
    txn`
      delete from ${meetingEntities}
      where ${meetingEntities.meetingId} = ${input.meetingId}::uuid
    `,
    ...buildAudioBatchInsertQueries(txn, transcriptions),
    txn`
      update meetings
      set status = 'processing', updated_at = ${now}
      where id = ${input.meetingId}::uuid
    `,
  ]);

  return { meetingId: input.meetingId, transcriptions };
}

function buildAudioBatchRows(input: {
  files: CompletedAudioBatchFile[];
  meetingId: string;
  modeForIndex: (index: number) => "append" | "replace";
  startedAt: Date;
}) {
  const generationId = randomUUID();
  let offsetMs = 0;
  const jobCreatedAtMs = Date.now();

  return input.files.map((file, index) => {
    const startedAt = new Date(input.startedAt.getTime() + offsetMs);
    const row = {
      ...file,
      endedAt: new Date(startedAt.getTime() + file.durationMs),
      generationId,
      mediaAssetId: randomUUID(),
      meetingId: input.meetingId,
      jobCreatedAt: new Date(jobCreatedAtMs + index),
      mode: input.modeForIndex(index),
      recordingId: randomUUID(),
      startedAt,
      transcriptJobId: randomUUID(),
    };

    offsetMs += file.durationMs;
    return row;
  });
}

function buildAudioBatchInsertQueries(
  txn: NeonQueryFunctionInTransaction<false, false>,
  rows: ReturnType<typeof buildAudioBatchRows>,
) {
  const env = parseR2Env(process.env);

  return rows.flatMap((row) => [
    txn`
      insert into recordings (
        id,
        meeting_id,
        source,
        started_at,
        ended_at,
        duration_ms
      )
      values (
        ${row.recordingId}::uuid,
        ${row.meetingId}::uuid,
        'upload',
        ${row.startedAt},
        ${row.endedAt},
        ${row.durationMs}
      )
    `,
    txn`
      insert into media_assets (
        id,
        meeting_id,
        recording_id,
        source,
        type,
        bucket,
        object_key,
        mime_type,
        file_size_bytes
      )
      values (
        ${row.mediaAssetId}::uuid,
        ${row.meetingId}::uuid,
        ${row.recordingId}::uuid,
        'upload',
        'audio',
        ${env.R2_BUCKET},
        ${row.objectKey},
        ${row.mimeType},
        ${row.fileSizeBytes}
      )
    `,
    txn`
      insert into transcript_jobs (
        id,
        meeting_id,
        media_asset_id,
        recording_id,
        generation_id,
        provider,
        status,
        mode,
        created_at,
        updated_at
      )
      values (
        ${row.transcriptJobId}::uuid,
        ${row.meetingId}::uuid,
        ${row.mediaAssetId}::uuid,
        ${row.recordingId}::uuid,
        ${row.generationId}::uuid,
        'elevenlabs',
        'queued',
        ${row.mode}::transcript_mode,
        ${row.jobCreatedAt},
        ${row.jobCreatedAt}
      )
    `,
  ]);
}

async function findExistingAudioBatch(
  objectKeys: string[],
  expectedMeetingId?: string,
) {
  const rows = await db
    .select({
      mediaAssetId: mediaAssets.id,
      meetingId: mediaAssets.meetingId,
      objectKey: mediaAssets.objectKey,
      recordingId: mediaAssets.recordingId,
      transcriptJobId: transcriptJobs.id,
    })
    .from(mediaAssets)
    .innerJoin(transcriptJobs, eq(transcriptJobs.mediaAssetId, mediaAssets.id))
    .where(
      and(
        inArray(mediaAssets.objectKey, objectKeys),
        expectedMeetingId
          ? eq(mediaAssets.meetingId, expectedMeetingId)
          : undefined,
      ),
    );

  if (rows.length === 0) {
    return null;
  }

  const rowByObjectKey = new Map(rows.map((row) => [row.objectKey, row]));
  const meetingIds = new Set(rows.map((row) => row.meetingId));

  if (
    rows.length !== objectKeys.length ||
    meetingIds.size !== 1 ||
    rows.some((row) => !row.recordingId)
  ) {
    throw new Error("Audio batch is only partially complete");
  }

  const meetingId = rows[0]?.meetingId;

  if (!meetingId) {
    return null;
  }

  return {
    meetingId,
    transcriptions: objectKeys.map((objectKey) => {
      const row = rowByObjectKey.get(objectKey);

      if (!row?.recordingId) {
        throw new Error("Audio batch recording is unavailable");
      }

      return {
        mediaAssetId: row.mediaAssetId,
        meetingId,
        objectKey,
        recordingId: row.recordingId,
        transcriptJobId: row.transcriptJobId,
      } satisfies AudioBatchTranscription;
    }),
  };
}
