import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
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
  const [existingRecording] = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(
      and(
        eq(recordings.meetingId, input.meetingId),
        eq(recordings.source, "recall"),
        eq(recordings.externalId, input.externalRecordingId),
      ),
    )
    .limit(1);
  let recording = existingRecording;

  if (!recording) {
    [recording] = await db
      .insert(recordings)
      .values({
        durationMs: input.durationMs,
        endedAt: input.endedAt,
        externalBotId: input.externalBotId,
        externalId: input.externalRecordingId,
        meetingId: input.meetingId,
        source: "recall",
        startedAt: input.startedAt,
      })
      .onConflictDoNothing()
      .returning({ id: recordings.id });
  }

  if (!recording) {
    [recording] = await db
      .select({ id: recordings.id })
      .from(recordings)
      .where(
        and(
          eq(recordings.meetingId, input.meetingId),
          eq(recordings.source, "recall"),
          eq(recordings.externalId, input.externalRecordingId),
        ),
      )
      .limit(1);
  }

  if (!recording) {
    throw new Error("Recall recording could not be created");
  }

  await recordRecallRecordingUsage({
    durationMs: input.durationMs,
    meetingId: input.meetingId,
    recordingId: recording.id,
  });

  const [existingJob] = await db
    .select({ id: transcriptJobs.id })
    .from(transcriptJobs)
    .where(eq(transcriptJobs.recordingId, recording.id))
    .limit(1);

  if (existingJob) {
    return {
      meetingId: input.meetingId,
      recordingId: recording.id,
      shouldQueue: false,
      transcriptJobId: existingJob.id,
    };
  }

  let [job] = await db
    .insert(transcriptJobs)
    .values({
      meetingId: input.meetingId,
      mode: input.mode ?? "replace",
      provider: "elevenlabs",
      recordingId: recording.id,
      status: "queued",
    })
    .onConflictDoNothing()
    .returning({ id: transcriptJobs.id });
  const shouldQueue = Boolean(job);

  if (!job) {
    [job] = await db
      .select({ id: transcriptJobs.id })
      .from(transcriptJobs)
      .where(eq(transcriptJobs.recordingId, recording.id))
      .limit(1);
  }

  if (!job) {
    throw new Error("Recall transcript job could not be created");
  }

  return {
    meetingId: input.meetingId,
    recordingId: recording.id,
    shouldQueue,
    transcriptJobId: job.id,
  };
}
