import { eq } from "drizzle-orm";

import { databaseSql, db } from "@/db/client";
import { PgDialect } from "drizzle-orm/pg-core";
import { recordingTimelineRebaseQuery } from "@/lib/recording-timeline";
import { mediaAssets, meetings, recordings, transcriptJobs } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
import { recordRecallRecordingUsage } from "@/lib/provider-usage";
import {
  buildMeetingObjectKey,
  getObjectMetadata,
  parseR2Env,
} from "@/lib/r2";
import {
  assertCanCreateMeetings,
  getOrCreateWorkspaceForSessionUser,
} from "@/lib/workspace";

type CreateUploadedAudioTranscriptionInput = {
  sessionUser: SessionUser;
  objectKey: string;
  title?: string;
  startedAt?: Date;
  durationMs?: number;
  fileSizeBytes?: number;
  mimeType?: string;
};

type CreateUploadedVideoTranscriptionInput =
  CreateUploadedAudioTranscriptionInput;

type CompleteUploadedVideoConversionInput = {
  meetingId: string;
  audioMediaAssetId: string;
  audioObjectKey: string;
  transcriptJobId: string;
  recordingId?: string;
};

export async function createUploadedAudioTranscription(
  input: CreateUploadedAudioTranscriptionInput,
) {
  const env = parseR2Env(process.env);
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);

  const [meeting] = await db
    .insert(meetings)
    .values({
      teamId: workspace.teamId,
      ownerUserId: workspace.userId,
      title: input.title?.trim() || "Uploaded audio",
      platform: "upload",
      status: "processing",
      startedAt: input.startedAt ?? new Date(),
    })
    .returning({ id: meetings.id });

  await reconcileMeetingSharingForMeeting(meeting.id);

  const [recording] = await db
    .insert(recordings)
    .values({
      durationMs: input.durationMs,
      endedAt:
        input.startedAt && input.durationMs
          ? new Date(input.startedAt.getTime() + input.durationMs)
          : undefined,
      meetingId: meeting.id,
      source: "upload",
      startedAt: input.startedAt,
    })
    .returning({ id: recordings.id });

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      meetingId: meeting.id,
      recordingId: recording.id,
      source: "upload",
      type: "audio",
      bucket: env.R2_BUCKET,
      objectKey: input.objectKey,
      mimeType: input.mimeType ?? "audio/mpeg",
      fileSizeBytes: input.fileSizeBytes,
    })
    .returning({ id: mediaAssets.id });

  const [job] = await db
    .insert(transcriptJobs)
    .values({
      meetingId: meeting.id,
      mediaAssetId: asset.id,
      recordingId: recording.id,
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });

  return {
    meetingId: meeting.id,
    mediaAssetId: asset.id,
    recordingId: recording.id,
    transcriptJobId: job.id,
  };
}

export async function createUploadedVideoTranscription(
  input: CreateUploadedVideoTranscriptionInput,
) {
  const env = parseR2Env(process.env);
  const workspace = await getOrCreateWorkspaceForSessionUser(input.sessionUser);
  await assertCanCreateMeetings(workspace);

  const [meeting] = await db
    .insert(meetings)
    .values({
      teamId: workspace.teamId,
      ownerUserId: workspace.userId,
      title: input.title?.trim() || "Uploaded video",
      platform: "upload",
      status: "processing",
      startedAt: input.startedAt ?? new Date(),
    })
    .returning({ id: meetings.id });

  await reconcileMeetingSharingForMeeting(meeting.id);

  const [recording] = await db
    .insert(recordings)
    .values({
      durationMs: input.durationMs,
      endedAt:
        input.startedAt && input.durationMs
          ? new Date(input.startedAt.getTime() + input.durationMs)
          : undefined,
      meetingId: meeting.id,
      source: "upload",
      startedAt: input.startedAt,
    })
    .returning({ id: recordings.id });

  const [sourceAsset] = await db
    .insert(mediaAssets)
    .values({
      meetingId: meeting.id,
      recordingId: recording.id,
      source: "upload",
      type: "transcript_source",
      bucket: env.R2_BUCKET,
      objectKey: input.objectKey,
      mimeType: input.mimeType ?? "video/mp4",
      fileSizeBytes: input.fileSizeBytes,
    })
    .returning({ id: mediaAssets.id });

  const [job] = await db
    .insert(transcriptJobs)
    .values({
      meetingId: meeting.id,
      mediaAssetId: null,
      recordingId: recording.id,
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });
  const audioMediaAssetId = job.id;
  const audioObjectKey = buildMeetingObjectKey({
    teamId: workspace.teamId,
    meetingId: meeting.id,
    assetId: audioMediaAssetId,
    extension: "mp3",
  });

  return {
    meetingId: meeting.id,
    sourceMediaAssetId: sourceAsset.id,
    audioMediaAssetId,
    audioObjectKey,
    recordingId: recording.id,
    transcriptJobId: job.id,
  };
}

export async function completeUploadedVideoConversion(
  input: CompleteUploadedVideoConversionInput,
) {
  const env = parseR2Env(process.env);
  const objectMetadata = await getObjectMetadata({
    key: input.audioObjectKey,
  });

  await db
    .insert(mediaAssets)
    .values({
      id: input.audioMediaAssetId,
      meetingId: input.meetingId,
      recordingId: input.recordingId,
      source: "upload",
      type: "audio",
      bucket: env.R2_BUCKET,
      objectKey: input.audioObjectKey,
      mimeType: "audio/mpeg",
      fileSizeBytes: objectMetadata.contentLength,
    })
    .onConflictDoNothing({ target: mediaAssets.id });

  await db
    .update(transcriptJobs)
    .set({
      mediaAssetId: input.audioMediaAssetId,
      updatedAt: new Date(),
    })
    .where(eq(transcriptJobs.id, input.transcriptJobId));

  return {
    meetingId: input.meetingId,
    mediaAssetId: input.audioMediaAssetId,
    objectKey: input.audioObjectKey,
    ...(input.recordingId ? { recordingId: input.recordingId } : {}),
    transcriptJobId: input.transcriptJobId,
  };
}

export async function createRecallRecordingTranscription(input: {
  durationMs?: number;
  endedAt?: Date;
  externalBotId?: string;
  externalRecordingId: string;
  meetingId: string;
  mode?: "append" | "replace";
  startedAt?: Date;
}) {
  const timelineRebase = new PgDialect().sqlToQuery(recordingTimelineRebaseQuery(input.meetingId));
  const [, rows] = await databaseSql.transaction((tx) => [
    tx`select pg_advisory_xact_lock(hashtextextended(${`recording-timeline:${input.meetingId}`}, 0))`,
    tx`
      with recording as (
        insert into recordings (meeting_id, source, external_id, external_bot_id, started_at, ended_at, duration_ms)
        values (${input.meetingId}::uuid, 'recall', ${input.externalRecordingId}, ${input.externalBotId ?? null},
          ${input.startedAt ?? null}, ${input.endedAt ?? null}, ${input.durationMs ?? null})
        on conflict (source, external_id) where external_id is not null do update
        set started_at = coalesce(recordings.started_at, excluded.started_at),
          ended_at = coalesce(recordings.ended_at, excluded.ended_at),
          duration_ms = coalesce(recordings.duration_ms, excluded.duration_ms)
        where recordings.meeting_id = excluded.meeting_id
        returning id
      ), job as (
        insert into transcript_jobs (meeting_id, recording_id, mode, provider, status)
        select ${input.meetingId}::uuid, recording.id,
          (case when ${input.mode ?? "replace"} = 'append'
            and not exists (select 1 from transcript_jobs prior where prior.meeting_id = ${input.meetingId}::uuid)
            then 'replace' else ${input.mode ?? "replace"} end)::transcript_mode,
          'elevenlabs', 'queued'
        from recording
        on conflict (recording_id) where recording_id is not null do update
        set recording_id = excluded.recording_id
        returning id, recording_id, status, provider_job_id
      )
      select id as transcript_job_id, recording_id,
        (status = 'queued' and provider_job_id is null) as should_queue from job
    `,
    tx.query(timelineRebase.sql, timelineRebase.params),
  ]);
  const [job] = rows as Array<{ transcript_job_id: string; recording_id: string; should_queue: boolean }>;
  if (!job) throw new Error("Recall recording could not be created");
  await recordRecallRecordingUsage({ durationMs: input.durationMs, meetingId: input.meetingId, recordingId: job.recording_id });
  return {
    meetingId: input.meetingId,
    recordingId: job.recording_id,
    shouldQueue: job.should_queue,
    transcriptJobId: job.transcript_job_id,
  };
}
