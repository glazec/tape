import { db } from "@/db/client";
import { mediaAssets, meetings, transcriptJobs } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { parseR2Env } from "@/lib/r2";
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
