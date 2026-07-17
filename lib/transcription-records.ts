import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { mediaAssets, meetings, transcriptJobs } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
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

  const [asset] = await db
    .insert(mediaAssets)
    .values({
      meetingId: meeting.id,
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
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });

  return {
    meetingId: meeting.id,
    mediaAssetId: asset.id,
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

  const [sourceAsset] = await db
    .insert(mediaAssets)
    .values({
      meetingId: meeting.id,
      source: "upload",
      type: "transcript_source",
      bucket: env.R2_BUCKET,
      objectKey: input.objectKey,
      mimeType: input.mimeType ?? "video/mp4",
      fileSizeBytes: input.fileSizeBytes,
    })
    .returning({ id: mediaAssets.id });

  const audioMediaAssetId = crypto.randomUUID();
  const audioObjectKey = buildMeetingObjectKey({
    teamId: workspace.teamId,
    meetingId: meeting.id,
    assetId: audioMediaAssetId,
    extension: "mp3",
  });

  const [job] = await db
    .insert(transcriptJobs)
    .values({
      meetingId: meeting.id,
      mediaAssetId: null,
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });

  return {
    meetingId: meeting.id,
    sourceMediaAssetId: sourceAsset.id,
    audioMediaAssetId,
    audioObjectKey,
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
    transcriptJobId: input.transcriptJobId,
  };
}

export async function createRecallRecordingTranscription(input: {
  meetingId: string;
}) {
  const [job] = await db
    .insert(transcriptJobs)
    .values({
      meetingId: input.meetingId,
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });

  return {
    meetingId: input.meetingId,
    transcriptJobId: job.id,
  };
}
