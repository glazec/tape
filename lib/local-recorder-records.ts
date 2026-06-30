import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  localRecorderDevices,
  localRecordingAttempts,
  localRecordings,
  mediaAssets,
  meetings,
  transcriptJobs,
} from "@/db/schema";
import { inngest } from "@/inngest/client";
import {
  canUploadLocalRecorderAttempt,
  getLocalRecorderEligibility,
  type LocalRecorderCandidate,
} from "@/lib/local-recorder-policy";
import { mixLocalRecorderWavTracks } from "@/lib/local-recorder-wav";
import {
  buildMeetingObjectKey,
  parseR2Env,
  putObject,
} from "@/lib/r2";
import type { WorkspaceContext } from "@/lib/workspace";

export type LocalRecorderMeetingItem = {
  displayTimeWindow: {
    endsAt: string | null;
    startsAt: string;
  };
  expiresAt: string;
  fallbackIntentId: string;
  title: string;
};

const intentTokenBytes = 18;
const activeAttemptStates = ["started", "uploading", "uploaded"];

export async function listMissedLocalRecorderMeetings(input: {
  deviceId: string;
  now: Date;
  workspace: WorkspaceContext;
}): Promise<LocalRecorderMeetingItem[]> {
  const deviceIdHash = await hashLocalRecorderValue(input.deviceId);

  await db
    .insert(localRecorderDevices)
    .values({
      appVersion: null,
      deviceIdHash,
      lastSeenAt: input.now,
      teamId: input.workspace.teamId,
      userId: input.workspace.userId,
    })
    .onConflictDoUpdate({
      target: [
        localRecorderDevices.teamId,
        localRecorderDevices.userId,
        localRecorderDevices.deviceIdHash,
      ],
      set: {
        lastSeenAt: input.now,
        updatedAt: input.now,
      },
    });

  const rows = await db
    .select({
      activeTranscriptJob: sql<boolean>`exists (
        select 1 from ${transcriptJobs}
        where ${transcriptJobs.meetingId} = ${meetings.id}
          and ${transcriptJobs.status} in ('queued', 'running', 'completed')
      )`,
      endedAt: meetings.endedAt,
      id: meetings.id,
      latestRecallCode: sql<string | null>`null`,
      latestRecallStatus: sql<string | null>`null`,
      meetingUrl: meetings.meetingUrl,
      recallAudioAsset: sql<boolean>`exists (
        select 1 from ${mediaAssets}
        where ${mediaAssets.meetingId} = ${meetings.id}
          and ${mediaAssets.source} = 'recall'
          and ${mediaAssets.type} = 'audio'
      )`,
      recallRecordingId: meetings.recallRecordingId,
      startedAt: meetings.startedAt,
      status: meetings.status,
      title: meetings.title,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, input.workspace.teamId),
        isNotNull(meetings.meetingUrl),
      ),
    )
    .orderBy(desc(meetings.startedAt))
    .limit(50);
  const items: LocalRecorderMeetingItem[] = [];

  for (const row of rows) {
    const candidate: LocalRecorderCandidate = {
      activeTranscriptJob: row.activeTranscriptJob,
      endedAt: row.endedAt,
      latestRecallCode: row.latestRecallCode,
      latestRecallStatus: row.latestRecallStatus,
      meetingId: row.id,
      meetingUrl: row.meetingUrl,
      recallAudioAsset: row.recallAudioAsset,
      recallRecordingId: row.recallRecordingId,
      startedAt: row.startedAt,
      status: row.status,
    };
    const eligibility = getLocalRecorderEligibility(candidate, {
      now: input.now,
    });

    if (!eligibility.eligible || !row.startedAt) {
      continue;
    }

    const activeAttempt = await findLocalRecorderAttempt({
      deviceIdHash,
      meetingId: row.id,
      userId: input.workspace.userId,
    });

    if (activeAttempt) {
      continue;
    }

    const fallbackIntentId = createFallbackIntentId();
    const fallbackIntentIdHash =
      await hashLocalRecorderValue(fallbackIntentId);

    await db.insert(localRecordingAttempts).values({
      attemptState: "notified",
      deviceIdHash,
      expiresAt: eligibility.expiresAt,
      fallbackIntentIdHash,
      meetingId: row.id,
      notificationState: "shown",
      userId: input.workspace.userId,
    });

    items.push({
      displayTimeWindow: {
        endsAt: row.endedAt?.toISOString() ?? null,
        startsAt: row.startedAt.toISOString(),
      },
      expiresAt: eligibility.expiresAt.toISOString(),
      fallbackIntentId,
      title: row.title,
    });
  }

  return items;
}

export async function claimLocalRecorderIntent(input: {
  deviceId: string;
  fallbackIntentId: string;
  now: Date;
  workspace: WorkspaceContext;
}) {
  const deviceIdHash = await hashLocalRecorderValue(input.deviceId);
  const fallbackIntentIdHash = await hashLocalRecorderValue(
    input.fallbackIntentId,
  );
  const [attempt] = await db
    .select({
      activeTranscriptJob: sql<boolean>`exists (
        select 1 from ${transcriptJobs}
        where ${transcriptJobs.meetingId} = ${meetings.id}
          and ${transcriptJobs.status} in ('queued', 'running', 'completed')
      )`,
      endedAt: meetings.endedAt,
      expiresAt: localRecordingAttempts.expiresAt,
      id: localRecordingAttempts.id,
      meetingUrl: meetings.meetingUrl,
      meetingId: localRecordingAttempts.meetingId,
      recallAudioAsset: sql<boolean>`exists (
        select 1 from ${mediaAssets}
        where ${mediaAssets.meetingId} = ${meetings.id}
          and ${mediaAssets.source} = 'recall'
          and ${mediaAssets.type} = 'audio'
      )`,
      recallRecordingId: meetings.recallRecordingId,
      startedAt: meetings.startedAt,
      status: meetings.status,
      title: meetings.title,
    })
    .from(localRecordingAttempts)
    .innerJoin(meetings, eq(meetings.id, localRecordingAttempts.meetingId))
    .where(
      and(
        eq(localRecordingAttempts.userId, input.workspace.userId),
        eq(localRecordingAttempts.deviceIdHash, deviceIdHash),
        eq(localRecordingAttempts.fallbackIntentIdHash, fallbackIntentIdHash),
      ),
    )
    .limit(1);

  if (!attempt || attempt.expiresAt < input.now) {
    return { claimed: false, reason: "expired_or_missing" as const };
  }

  const eligibility = getLocalRecorderEligibility(
    {
      activeTranscriptJob: attempt.activeTranscriptJob,
      endedAt: attempt.endedAt,
      latestRecallCode: null,
      latestRecallStatus: null,
      meetingId: attempt.meetingId,
      meetingUrl: attempt.meetingUrl,
      recallAudioAsset: attempt.recallAudioAsset,
      recallRecordingId: attempt.recallRecordingId,
      startedAt: attempt.startedAt,
      status: attempt.status,
    },
    { now: input.now },
  );

  if (!eligibility.eligible) {
    return { claimed: false, reason: "no_longer_eligible" as const };
  }

  const activePrimary = await db
    .select({ id: localRecordingAttempts.id })
    .from(localRecordingAttempts)
    .where(
      and(
        eq(localRecordingAttempts.meetingId, attempt.meetingId),
        inArray(localRecordingAttempts.attemptState, activeAttemptStates),
      ),
    )
    .limit(1);

  if (activePrimary[0] && activePrimary[0].id !== attempt.id) {
    return { claimed: false, reason: "already_recording" as const };
  }

  await db
    .update(localRecordingAttempts)
    .set({
      attemptState: "started",
      claimedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(localRecordingAttempts.id, attempt.id));

  return { claimed: true, meetingTitle: attempt.title };
}

export async function createLocalRecorderRecording(input: {
  clientRecordingId: string;
  computerAudio: File;
  deviceId: string;
  fallbackIntentId: string;
  manifest: unknown;
  microphoneAudio: File;
  recordingStartedAt: Date;
  recordingStoppedAt: Date;
  workspace: WorkspaceContext;
}) {
  const now = new Date();
  const deviceIdHash = await hashLocalRecorderValue(input.deviceId);
  const fallbackIntentIdHash = await hashLocalRecorderValue(
    input.fallbackIntentId,
  );
  const [attempt] = await db
    .select({
      attemptState: localRecordingAttempts.attemptState,
      expiresAt: localRecordingAttempts.expiresAt,
      id: localRecordingAttempts.id,
      meetingId: localRecordingAttempts.meetingId,
    })
    .from(localRecordingAttempts)
    .where(
      and(
        eq(localRecordingAttempts.userId, input.workspace.userId),
        eq(localRecordingAttempts.deviceIdHash, deviceIdHash),
        eq(localRecordingAttempts.fallbackIntentIdHash, fallbackIntentIdHash),
      ),
    )
    .limit(1);

  if (!attempt) {
    throw new LocalRecorderUploadError("No matching local recording intent");
  }

  const existingRecording = await findExistingLocalRecording({
    clientRecordingId: input.clientRecordingId,
    ownerUserId: input.workspace.userId,
  });

  if (existingRecording) {
    if (existingRecording.meetingId !== attempt.meetingId) {
      throw new LocalRecorderUploadError(
        "Local recording already belongs to another meeting",
      );
    }

    return {
      localRecordingId: existingRecording.id,
      meetingId: existingRecording.meetingId,
      queued: true,
    };
  }

  if (
    !canUploadLocalRecorderAttempt({
      attemptState: attempt.attemptState,
      intentExpiresAt: attempt.expiresAt,
      intentMeetingId: attempt.meetingId,
      meetingId: attempt.meetingId,
      recordingStartedAt: input.recordingStartedAt,
    })
  ) {
    throw new LocalRecorderUploadError("No matching local recording intent");
  }

  await db
    .update(localRecordingAttempts)
    .set({ attemptState: "uploading", updatedAt: now })
    .where(eq(localRecordingAttempts.id, attempt.id));

  const computerAudioBytes = new Uint8Array(
    await input.computerAudio.arrayBuffer(),
  );
  const microphoneAudioBytes = new Uint8Array(
    await input.microphoneAudio.arrayBuffer(),
  );
  const synthesizedAudioBytes = mixLocalRecorderWavTracks(
    computerAudioBytes,
    microphoneAudioBytes,
  );
  const computerAssetId = crypto.randomUUID();
  const microphoneAssetId = crypto.randomUUID();
  const synthesizedAssetId = crypto.randomUUID();
  const env = parseR2Env(process.env);
  const computerKey = buildMeetingObjectKey({
    assetId: computerAssetId,
    extension: "wav",
    meetingId: attempt.meetingId,
    teamId: input.workspace.teamId,
  });
  const microphoneKey = buildMeetingObjectKey({
    assetId: microphoneAssetId,
    extension: "wav",
    meetingId: attempt.meetingId,
    teamId: input.workspace.teamId,
  });
  const synthesizedKey = buildMeetingObjectKey({
    assetId: synthesizedAssetId,
    extension: "wav",
    meetingId: attempt.meetingId,
    teamId: input.workspace.teamId,
  });

  await Promise.all([
    putObject({
      body: computerAudioBytes,
      contentType: "audio/wav",
      key: computerKey,
    }),
    putObject({
      body: microphoneAudioBytes,
      contentType: "audio/wav",
      key: microphoneKey,
    }),
    putObject({
      body: synthesizedAudioBytes,
      contentType: "audio/wav",
      key: synthesizedKey,
    }),
  ]);

  await db.insert(mediaAssets).values([
    {
      bucket: env.R2_BUCKET,
      id: computerAssetId,
      meetingId: attempt.meetingId,
      mimeType: "audio/wav",
      objectKey: computerKey,
      source: "local_recorder",
      type: "computer_audio",
    },
    {
      bucket: env.R2_BUCKET,
      id: microphoneAssetId,
      meetingId: attempt.meetingId,
      mimeType: "audio/wav",
      objectKey: microphoneKey,
      source: "local_recorder",
      type: "microphone_audio",
    },
    {
      bucket: env.R2_BUCKET,
      id: synthesizedAssetId,
      meetingId: attempt.meetingId,
      mimeType: "audio/wav",
      objectKey: synthesizedKey,
      source: "local_recorder",
      type: "synthesized_audio",
    },
  ]);

  const [recording] = await db
    .insert(localRecordings)
    .values({
      clientRecordingId: input.clientRecordingId,
      computerAudioAssetId: computerAssetId,
      isPrimary: true,
      localRecordingAttemptId: attempt.id,
      manifest: input.manifest,
      meetingId: attempt.meetingId,
      microphoneAudioAssetId: microphoneAssetId,
      ownerUserId: input.workspace.userId,
      recordingStartedAt: input.recordingStartedAt,
      recordingStoppedAt: input.recordingStoppedAt,
      synthesizedAudioAssetId: synthesizedAssetId,
      synthesisStatus: "completed",
    })
    .onConflictDoUpdate({
      target: [localRecordings.ownerUserId, localRecordings.clientRecordingId],
      set: {
        updatedAt: now,
      },
    })
    .returning({ id: localRecordings.id });
  const [job] = await db
    .insert(transcriptJobs)
    .values({
      mediaAssetId: synthesizedAssetId,
      meetingId: attempt.meetingId,
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });

  await db
    .update(localRecordingAttempts)
    .set({ attemptState: "uploaded", updatedAt: now })
    .where(eq(localRecordingAttempts.id, attempt.id));

  await inngest.send({
    name: "meeting/transcribe.audio",
    data: {
      mediaAssetId: synthesizedAssetId,
      meetingId: attempt.meetingId,
      objectKey: synthesizedKey,
      transcriptJobId: job.id,
    },
  });

  return {
    localRecordingId: recording.id,
    meetingId: attempt.meetingId,
    queued: true,
  };
}

export class LocalRecorderUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalRecorderUploadError";
  }
}

async function findLocalRecorderAttempt(input: {
  deviceIdHash: string;
  meetingId: string;
  userId: string;
}) {
  const rows = await db
    .select({ id: localRecordingAttempts.id })
    .from(localRecordingAttempts)
    .where(
      and(
        eq(localRecordingAttempts.meetingId, input.meetingId),
        eq(localRecordingAttempts.userId, input.userId),
        eq(localRecordingAttempts.deviceIdHash, input.deviceIdHash),
        inArray(localRecordingAttempts.attemptState, [
          "notified",
          "started",
          "uploading",
          "uploaded",
        ]),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

async function findExistingLocalRecording(input: {
  clientRecordingId: string;
  ownerUserId: string;
}) {
  const rows = await db
    .select({
      id: localRecordings.id,
      meetingId: localRecordings.meetingId,
    })
    .from(localRecordings)
    .where(
      and(
        eq(localRecordings.ownerUserId, input.ownerUserId),
        eq(localRecordings.clientRecordingId, input.clientRecordingId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

function createFallbackIntentId() {
  const bytes = crypto.getRandomValues(new Uint8Array(intentTokenBytes));

  return Buffer.from(bytes).toString("base64url");
}

async function hashLocalRecorderValue(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Buffer.from(digest).toString("base64url");
}
