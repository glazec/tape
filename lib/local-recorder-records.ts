import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db/client";
import {
  localRecorderDevices,
  localRecordingAttempts,
  localRecordings,
  mediaAssets,
  meetings,
  recordings,
  transcriptJobs,
} from "@/db/schema";
import { inngest } from "@/inngest/client";
import {
  canUploadLocalRecorderAttempt,
  getLocalRecorderEligibility,
  isWithinLocalRecorderAutoClaimWindow,
  type LocalRecorderCandidate,
} from "@/lib/local-recorder-policy";
import { reconcileMeetingSharingForMeeting } from "@/lib/meeting-share-rules";
import {
  buildMeetingObjectKey,
  createUploadUrl,
  getObjectMetadata,
  parseR2Env,
} from "@/lib/r2";
import {
  createRecallDesktopSdkUpload,
  getRecallApiBaseUrl,
  retrieveRecallBot,
} from "@/lib/vendors/recall";
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

type LocalRecorderBotStatus =
  | "not_planned"
  | "planned"
  | "in_meeting_room"
  | "joined"
  | "recording"
  | "done"
  | "failed"
  | "cancelled";

type LocalRecorderMonitoringMeeting = {
  botStatus: LocalRecorderBotStatus;
  botStatusDetail: string;
  botStatusLabel: string;
  endsAt: string | null;
  meetingId: string;
  startsAt: string;
  title: string;
};

export type LocalRecorderMonitoringStatus = {
  missedMeetings: LocalRecorderMeetingItem[];
  nextMeeting: LocalRecorderMonitoringMeeting | null;
};

export type LocalRecorderUploadAssetIds = {
  computerAudioAssetId: string;
  microphoneAudioAssetId: string;
  synthesizedAudioAssetId: string;
};

type LocalRecorderTranscriptionEventInput = {
  mediaAssetId: string;
  meetingId: string;
  objectKey: string;
  recordingId: string;
  transcriptJobId: string;
};

const intentTokenBytes = 18;
const activeAttemptStates = ["started", "uploading", "uploaded"];
const localRecorderAudioContentType = "audio/wav";
const recallSdkFallbackNotificationState = "recall_sdk_fallback";
const manualRecordingIntentTtlMs = 6 * 60 * 60 * 1000;
const scheduleLookbackMs = 30 * 60 * 1000;

export function buildLocalRecorderTranscriptionEvent(
  input: LocalRecorderTranscriptionEventInput,
) {
  return {
    id: `local-recorder-transcribe-${input.transcriptJobId}`,
    name: "meeting/transcribe.audio" as const,
    data: {
      mediaAssetId: input.mediaAssetId,
      meetingId: input.meetingId,
      objectKey: input.objectKey,
      recordingId: input.recordingId,
      transcriptJobId: input.transcriptJobId,
    },
  };
}

export async function createRecallDesktopSdkUploadForLocalRecorder(input: {
  clientRecordingId: string;
  deviceId: string;
  fallbackIntentId: string;
  requestUrl: string;
  workspace: WorkspaceContext;
}) {
  const attempt = await getStartedLocalRecorderAttempt({
    deviceId: input.deviceId,
    fallbackIntentId: input.fallbackIntentId,
    workspace: input.workspace,
  });
  const sdkUpload = await createRecallDesktopSdkUpload({
    webhookUrl: input.requestUrl,
    metadata: {
      clientRecordingId: input.clientRecordingId,
      fallbackIntentId: input.fallbackIntentId,
      meetingId: attempt.meetingId,
      source: "local_recorder_sdk",
      teamId: input.workspace.teamId,
      userId: input.workspace.userId,
    },
  });

  return {
    fallbackIntentId: input.fallbackIntentId,
    meetingId: attempt.meetingId,
    recallApiUrl: getRecallApiBaseUrl(),
    sdkUploadId: getSdkUploadId(sdkUpload),
    uploadToken: getSdkUploadToken(sdkUpload),
  };
}

export async function markRecallDesktopSdkFallback(input: {
  deviceId: string;
  fallbackIntentId: string;
  workspace: WorkspaceContext;
}) {
  const deviceIdHash = await hashLocalRecorderValue(input.deviceId);
  const fallbackIntentIdHash = await hashLocalRecorderValue(
    input.fallbackIntentId,
  );
  const [attempt] = await db
    .select({ id: localRecordingAttempts.id })
    .from(localRecordingAttempts)
    .where(
      and(
        eq(localRecordingAttempts.userId, input.workspace.userId),
        eq(localRecordingAttempts.deviceIdHash, deviceIdHash),
        eq(localRecordingAttempts.fallbackIntentIdHash, fallbackIntentIdHash),
        eq(localRecordingAttempts.attemptState, "started"),
      ),
    )
    .limit(1);

  if (!attempt) {
    return { marked: false };
  }

  await db
    .update(localRecordingAttempts)
    .set({
      notificationState: recallSdkFallbackNotificationState,
      updatedAt: new Date(),
    })
    .where(eq(localRecordingAttempts.id, attempt.id));

  return { marked: true };
}

export async function isRecallDesktopSdkFallbackIntent(
  fallbackIntentId: string,
) {
  const fallbackIntentIdHash = await hashLocalRecorderValue(fallbackIntentId);
  const [attempt] = await db
    .select({ notificationState: localRecordingAttempts.notificationState })
    .from(localRecordingAttempts)
    .where(
      eq(localRecordingAttempts.fallbackIntentIdHash, fallbackIntentIdHash),
    )
    .limit(1);

  return attempt?.notificationState === recallSdkFallbackNotificationState;
}

export function isLocalRecorderCandidateVisibleInLookup(input: {
  now: Date;
  startedAt: Date | null;
}) {
  return Boolean(input.startedAt && input.startedAt <= input.now);
}

export function isLocalRecorderMonitoringMeetingCurrent(input: {
  endedAt: Date | null;
  now: Date;
  startedAt: Date | null;
}) {
  return Boolean(
    input.startedAt &&
      input.startedAt <= input.now &&
      (!input.endedAt || input.endedAt >= input.now),
  );
}

export async function listMissedLocalRecorderMeetings(input: {
  appVersion?: string | null;
  deviceId: string;
  now: Date;
  permissionReadiness?: Record<string, unknown>;
  workspace: WorkspaceContext;
}): Promise<LocalRecorderMeetingItem[]> {
  const deviceIdHash = await hashLocalRecorderValue(input.deviceId);

  await db
    .insert(localRecorderDevices)
    .values({
      appVersion: input.appVersion ?? null,
      deviceIdHash,
      lastSeenAt: input.now,
      permissionReadiness: input.permissionReadiness ?? {},
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
        appVersion: input.appVersion ?? null,
        lastSeenAt: input.now,
        permissionReadiness: input.permissionReadiness ?? {},
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
      meetingUrl: meetings.meetingUrl,
      recallBotId: meetings.recallBotId,
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
        isNotNull(meetings.startedAt),
        lte(meetings.startedAt, input.now),
      ),
    )
    .orderBy(desc(meetings.startedAt))
    .limit(50);
  const items: LocalRecorderMeetingItem[] = [];

  for (const row of rows) {
    if (
      !isLocalRecorderCandidateVisibleInLookup({
        now: input.now,
        startedAt: row.startedAt,
      })
    ) {
      continue;
    }

    const recallState = await getLatestRecallBotState(row.recallBotId);
    const candidate: LocalRecorderCandidate = {
      activeTranscriptJob: row.activeTranscriptJob,
      endedAt: row.endedAt,
      latestRecallCode: recallState.latestRecallCode,
      latestRecallStatus: recallState.latestRecallStatus,
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

export async function getLocalRecorderMonitoringStatus(input: {
  appVersion?: string | null;
  deviceId: string;
  now: Date;
  permissionReadiness?: Record<string, unknown>;
  workspace: WorkspaceContext;
}): Promise<LocalRecorderMonitoringStatus> {
  const missedMeetings = await listMissedLocalRecorderMeetings(input);
  const [row] = await db
    .select({
      endedAt: meetings.endedAt,
      id: meetings.id,
      recallBotId: meetings.recallBotId,
      recallRecordingId: meetings.recallRecordingId,
      startedAt: meetings.startedAt,
      status: meetings.status,
      title: meetings.title,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.teamId, input.workspace.teamId),
        isNotNull(meetings.startedAt),
        inArray(meetings.status, ["scheduled", "recording"]),
        or(
          eq(meetings.status, "recording"),
          gte(meetings.startedAt, new Date(input.now.getTime() - scheduleLookbackMs)),
          and(
            lte(meetings.startedAt, input.now),
            or(isNull(meetings.endedAt), gte(meetings.endedAt, input.now)),
          ),
        ),
      ),
    )
    .orderBy(
      desc(sql`case when ${meetings.status} = 'recording' then 1 else 0 end`),
      desc(sql`case when ${meetings.startedAt} <= ${input.now} and (${meetings.endedAt} is null or ${meetings.endedAt} >= ${input.now}) then 1 else 0 end`),
      asc(meetings.startedAt),
    )
    .limit(1);

  return {
    missedMeetings,
    nextMeeting: row?.startedAt
      ? {
          botStatus: getLocalRecorderBotStatus(row, input.now),
          botStatusDetail: getLocalRecorderBotStatusDetail(row, input.now),
          botStatusLabel: getLocalRecorderBotStatusLabel(row, input.now),
          endsAt: row.endedAt?.toISOString() ?? null,
          meetingId: row.id,
          startsAt: row.startedAt.toISOString(),
          title: row.title,
        }
      : null,
  };
}

export async function createManualLocalRecorderIntent(input: {
  deviceId: string;
  now: Date;
  title?: string | null;
  workspace: WorkspaceContext;
}) {
  const deviceIdHash = await hashLocalRecorderValue(input.deviceId);
  const title = input.title?.trim() || "Manual recording";
  const fallbackIntentId = createFallbackIntentId();
  const fallbackIntentIdHash = await hashLocalRecorderValue(fallbackIntentId);

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
      set: { lastSeenAt: input.now },
    });

  const [meeting] = await db
    .insert(meetings)
    .values({
      ownerUserId: input.workspace.userId,
      platform: "in_person",
      startedAt: input.now,
      status: "recording",
      teamId: input.workspace.teamId,
      title,
    })
    .returning({ id: meetings.id, title: meetings.title });

  await reconcileMeetingSharingForMeeting(meeting.id);

  await db.insert(localRecordingAttempts).values({
    attemptState: "started",
    claimedAt: input.now,
    deviceIdHash,
    expiresAt: new Date(input.now.getTime() + manualRecordingIntentTtlMs),
    fallbackIntentIdHash,
    meetingId: meeting.id,
    notificationState: "manual",
    userId: input.workspace.userId,
  });

  return {
    fallbackIntentId,
    meetingTitle: meeting.title,
  };
}

async function getLatestRecallBotState(recallBotId: string | null) {
  if (!recallBotId) {
    return {
      latestRecallCode: null,
      latestRecallStatus: null,
    };
  }

  try {
    return extractLatestRecallBotState(await retrieveRecallBot(recallBotId));
  } catch {
    return {
      latestRecallCode: null,
      latestRecallStatus: null,
    };
  }
}

function extractLatestRecallBotState(bot: unknown) {
  const record = getRecord(bot);
  const statusChange = getLatestRecallStatusChange(record?.status_changes);

  return {
    latestRecallCode:
      getString(record?.sub_code) ??
      getString(record?.subCode) ??
      getString(statusChange?.sub_code) ??
      getString(statusChange?.subCode),
    latestRecallStatus:
      getString(record?.status) ??
      getString(record?.status_code) ??
      getString(record?.statusCode) ??
      getString(record?.code) ??
      getString(statusChange?.status) ??
      getString(statusChange?.status_code) ??
      getString(statusChange?.statusCode) ??
      getString(statusChange?.code),
  };
}

function getLatestRecallStatusChange(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value.slice().reverse()) {
    const record = getRecord(item);

    if (record) {
      return record;
    }
  }

  return null;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getLocalRecorderBotStatus(
  meeting: {
    endedAt: Date | null;
    recallBotId: string | null;
    recallRecordingId: string | null;
    startedAt: Date | null;
    status: string;
  },
  now: Date,
): LocalRecorderBotStatus {
  if (meeting.status === "cancelled") {
    return "cancelled";
  }

  if (meeting.status === "failed" || meeting.status === "missed") {
    return "failed";
  }

  if (meeting.status === "recording" && meeting.recallBotId) {
    return meeting.recallRecordingId ? "recording" : "joined";
  }

  if (
    meeting.status === "processing" ||
    meeting.status === "ready" ||
    meeting.recallRecordingId
  ) {
    return "done";
  }

  if (!meeting.recallBotId) {
    return "not_planned";
  }

  if (
    meeting.startedAt &&
    meeting.startedAt <= now &&
    (!meeting.endedAt || meeting.endedAt >= now)
  ) {
    return "in_meeting_room";
  }

  return "planned";
}

function getLocalRecorderBotStatusLabel(
  meeting: {
    endedAt: Date | null;
    recallBotId: string | null;
    recallRecordingId: string | null;
    startedAt: Date | null;
    status: string;
  },
  now: Date,
) {
  switch (getLocalRecorderBotStatus(meeting, now)) {
    case "cancelled":
      return "Cancelled";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "in_meeting_room":
      return "In meeting room";
    case "joined":
      return "Joined";
    case "not_planned":
      return "Not planned";
    case "planned":
      return "Planned";
    case "recording":
      return "Recording";
  }
}

function getLocalRecorderBotStatusDetail(
  meeting: {
    endedAt: Date | null;
    recallBotId: string | null;
    recallRecordingId: string | null;
    startedAt: Date | null;
    status: string;
  },
  now: Date,
) {
  switch (getLocalRecorderBotStatus(meeting, now)) {
    case "cancelled":
      return "Meeting was cancelled";
    case "done":
      return "Bot recording finished";
    case "failed":
      return "Bot could not record";
    case "in_meeting_room":
      return "Bot is waiting or joining";
    case "joined":
      return "Bot joined the call";
    case "not_planned":
      return "No bot is scheduled";
    case "planned":
      return "Bot is scheduled";
    case "recording":
      return "Bot is recording";
  }
}

export async function claimLocalRecorderIntent(input: {
  deviceId: string;
  explicit?: boolean;
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

  // Server-authoritative ad-hoc policy: an auto (non-explicit) claim only
  // attaches to a meeting that is live now. Explicit claims (the user tapped a
  // specific meeting or its notification) are always honored within the
  // eligibility window above. `explicit` defaults to true so older clients,
  // which send no flag, keep their existing behavior.
  if (
    input.explicit === false &&
    !isWithinLocalRecorderAutoClaimWindow({
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      now: input.now,
    })
  ) {
    return { claimed: false, reason: "ad_hoc_recommended" as const };
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

  try {
    await db
      .update(localRecordingAttempts)
      .set({
        attemptState: "started",
        claimedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(localRecordingAttempts.id, attempt.id));
  } catch (error) {
    if (isLocalRecorderPrimaryClaimConflict(error)) {
      return { claimed: false, reason: "already_recording" as const };
    }

    throw error;
  }

  return { claimed: true, meetingTitle: attempt.title };
}

export function isLocalRecorderPrimaryClaimConflict(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown; constraint?: unknown };

  return (
    candidate.code === "23505" &&
    candidate.constraint === "local_recording_attempts_primary_active_unique"
  );
}

export async function failLocalRecorderIntent(input: {
  deviceId: string;
  errorMessage: string | null;
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
      id: localRecordingAttempts.id,
      meetingId: localRecordingAttempts.meetingId,
    })
    .from(localRecordingAttempts)
    .where(
      and(
        eq(localRecordingAttempts.userId, input.workspace.userId),
        eq(localRecordingAttempts.deviceIdHash, deviceIdHash),
        eq(localRecordingAttempts.fallbackIntentIdHash, fallbackIntentIdHash),
        inArray(localRecordingAttempts.attemptState, ["started", "uploading"]),
      ),
    )
    .limit(1);

  if (!attempt) {
    return { failed: false, reason: "expired_or_missing" as const };
  }

  await db
    .update(localRecordingAttempts)
    .set({
      attemptState: "failed",
      errorMessage: input.errorMessage?.slice(0, 500) ?? null,
      updatedAt: input.now,
    })
    .where(eq(localRecordingAttempts.id, attempt.id));

  // Without this, a meeting whose recording failed client-side stays shown
  // as "Recording" on the dashboard forever.
  await db
    .update(meetings)
    .set({ status: "failed", updatedAt: input.now })
    .where(
      and(eq(meetings.id, attempt.meetingId), eq(meetings.status, "recording")),
    );

  return { failed: true };
}

export async function prepareLocalRecorderRecordingUpload(input: {
  clientRecordingId: string;
  deviceId: string;
  fallbackIntentId: string;
  manifest: unknown;
  recordingStartedAt: Date;
  recordingStoppedAt: Date;
  workspace: WorkspaceContext;
}) {
  const now = new Date();
  const attempt = await getUploadableLocalRecorderAttempt(input);

  if (await findExistingLocalRecording({
    clientRecordingId: input.clientRecordingId,
    ownerUserId: input.workspace.userId,
  })) {
    throw new LocalRecorderUploadError("Local recording already uploaded");
  }

  await db
    .update(localRecordingAttempts)
    .set({ attemptState: "uploading", updatedAt: now })
    .where(eq(localRecordingAttempts.id, attempt.id));

  const assetIds = createLocalRecorderAssetIds();
  const keys = buildLocalRecorderObjectKeys({
    assetIds,
    meetingId: attempt.meetingId,
    teamId: input.workspace.teamId,
  });

  const [computerUploadUrl, microphoneUploadUrl, synthesizedUploadUrl] =
    await Promise.all([
      createUploadUrl({
        contentType: localRecorderAudioContentType,
        key: keys.computerAudioKey,
      }),
      createUploadUrl({
        contentType: localRecorderAudioContentType,
        key: keys.microphoneAudioKey,
      }),
      createUploadUrl({
        contentType: localRecorderAudioContentType,
        key: keys.synthesizedAudioKey,
      }),
    ]);

  return {
    assets: {
      computerAudio: {
        assetId: assetIds.computerAudioAssetId,
        contentType: localRecorderAudioContentType,
        uploadUrl: computerUploadUrl,
      },
      microphoneAudio: {
        assetId: assetIds.microphoneAudioAssetId,
        contentType: localRecorderAudioContentType,
        uploadUrl: microphoneUploadUrl,
      },
      synthesizedAudio: {
        assetId: assetIds.synthesizedAudioAssetId,
        contentType: localRecorderAudioContentType,
        uploadUrl: synthesizedUploadUrl,
      },
    },
  };
}

export async function completeLocalRecorderRecordingUpload(input: {
  assets: LocalRecorderUploadAssetIds;
  clientRecordingId: string;
  deviceId: string;
  fallbackIntentId: string;
  manifest: unknown;
  recordingStartedAt: Date;
  recordingStoppedAt: Date;
  workspace: WorkspaceContext;
}) {
  const now = new Date();
  const attempt = await getUploadableLocalRecorderAttempt(input);
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

    await queueLocalRecorderTranscriptionForRecording({
      localRecordingId: existingRecording.id,
    });

    return {
      localRecordingId: existingRecording.id,
      meetingId: existingRecording.meetingId,
      queued: true,
    };
  }

  const keys = buildLocalRecorderObjectKeys({
    assetIds: input.assets,
    meetingId: attempt.meetingId,
    teamId: input.workspace.teamId,
  });
  const [
    computerAudioMetadata,
    microphoneAudioMetadata,
    synthesizedAudioMetadata,
  ] = await Promise.all([
    getObjectMetadata({ key: keys.computerAudioKey }),
    getObjectMetadata({ key: keys.microphoneAudioKey }),
    getObjectMetadata({ key: keys.synthesizedAudioKey }),
  ]).catch(() => {
    throw new LocalRecorderUploadError("Uploaded local recording audio not found");
  });
  const env = parseR2Env(process.env);

  await db
    .insert(mediaAssets)
    .values([
      {
        bucket: env.R2_BUCKET,
        fileSizeBytes: normalizeLocalRecorderFileSizeBytes(
          computerAudioMetadata.contentLength,
        ),
        id: input.assets.computerAudioAssetId,
        meetingId: attempt.meetingId,
        mimeType:
          computerAudioMetadata.contentType ?? localRecorderAudioContentType,
        objectKey: keys.computerAudioKey,
        source: "local_recorder",
        type: "computer_audio",
      },
      {
        bucket: env.R2_BUCKET,
        fileSizeBytes: normalizeLocalRecorderFileSizeBytes(
          microphoneAudioMetadata.contentLength,
        ),
        id: input.assets.microphoneAudioAssetId,
        meetingId: attempt.meetingId,
        mimeType:
          microphoneAudioMetadata.contentType ?? localRecorderAudioContentType,
        objectKey: keys.microphoneAudioKey,
        source: "local_recorder",
        type: "microphone_audio",
      },
      {
        bucket: env.R2_BUCKET,
        fileSizeBytes: normalizeLocalRecorderFileSizeBytes(
          synthesizedAudioMetadata.contentLength,
        ),
        id: input.assets.synthesizedAudioAssetId,
        meetingId: attempt.meetingId,
        mimeType:
          synthesizedAudioMetadata.contentType ?? localRecorderAudioContentType,
        objectKey: keys.synthesizedAudioKey,
        source: "local_recorder",
        type: "synthesized_audio",
      },
    ])
    .onConflictDoNothing();

  const [recording] = await db
    .insert(localRecordings)
    .values({
      clientRecordingId: input.clientRecordingId,
      computerAudioAssetId: input.assets.computerAudioAssetId,
      isPrimary: true,
      localRecordingAttemptId: attempt.id,
      manifest: input.manifest,
      meetingId: attempt.meetingId,
      microphoneAudioAssetId: input.assets.microphoneAudioAssetId,
      ownerUserId: input.workspace.userId,
      recordingStartedAt: input.recordingStartedAt,
      recordingStoppedAt: input.recordingStoppedAt,
      synthesizedAudioAssetId: input.assets.synthesizedAudioAssetId,
      synthesisStatus: "completed",
    })
    .onConflictDoUpdate({
      target: [localRecordings.ownerUserId, localRecordings.clientRecordingId],
      set: {
        updatedAt: now,
      },
    })
    .returning({ id: localRecordings.id });

  await db
    .insert(recordings)
    .values({
      durationMs:
        input.recordingStoppedAt.getTime() - input.recordingStartedAt.getTime(),
      endedAt: input.recordingStoppedAt,
      id: recording.id,
      meetingId: attempt.meetingId,
      source: "local_recorder",
      startedAt: input.recordingStartedAt,
    })
    .onConflictDoUpdate({
      target: recordings.id,
      set: {
        durationMs:
          input.recordingStoppedAt.getTime() -
          input.recordingStartedAt.getTime(),
        endedAt: input.recordingStoppedAt,
        startedAt: input.recordingStartedAt,
        updatedAt: now,
      },
    });

  await db
    .update(localRecordingAttempts)
    .set({ attemptState: "uploaded", updatedAt: now })
    .where(eq(localRecordingAttempts.id, attempt.id));

  await db
    .update(meetings)
    .set({
      status: "processing",
      updatedAt: now,
    })
    .where(eq(meetings.id, attempt.meetingId));

  const transcriptionEventInput =
    await getOrCreateLocalRecorderTranscriptionEventInput({
      localRecordingId: recording.id,
    });

  await queueLocalRecorderTranscription(transcriptionEventInput);

  return {
    localRecordingId: recording.id,
    meetingId: attempt.meetingId,
    queued: true,
  };
}

async function queueLocalRecorderTranscriptionForRecording(input: {
  localRecordingId: string;
}) {
  const eventInput = await getOrCreateLocalRecorderTranscriptionEventInput(input);
  await queueLocalRecorderTranscription(eventInput);
}

async function getOrCreateLocalRecorderTranscriptionEventInput(input: {
  localRecordingId: string;
}): Promise<LocalRecorderTranscriptionEventInput> {
  const [recording] = await db
    .select({
      mediaAssetId: mediaAssets.id,
      meetingId: localRecordings.meetingId,
      objectKey: mediaAssets.objectKey,
      recordingId: localRecordings.id,
      transcriptJobId: transcriptJobs.id,
    })
    .from(localRecordings)
    .innerJoin(
      mediaAssets,
      eq(mediaAssets.id, localRecordings.synthesizedAudioAssetId),
    )
    .leftJoin(
      transcriptJobs,
      and(
        eq(transcriptJobs.mediaAssetId, mediaAssets.id),
        eq(transcriptJobs.meetingId, localRecordings.meetingId),
      ),
    )
    .where(eq(localRecordings.id, input.localRecordingId))
    .orderBy(desc(transcriptJobs.createdAt))
    .limit(1);

  if (!recording) {
    throw new LocalRecorderUploadError("Local recording audio not found");
  }

  if (recording.transcriptJobId) {
    return {
      mediaAssetId: recording.mediaAssetId,
      meetingId: recording.meetingId,
      objectKey: recording.objectKey,
      recordingId: recording.recordingId,
      transcriptJobId: recording.transcriptJobId,
    };
  }

  const [job] = await db
    .insert(transcriptJobs)
    .values({
      mediaAssetId: recording.mediaAssetId,
      meetingId: recording.meetingId,
      provider: "elevenlabs",
      status: "queued",
    })
    .returning({ id: transcriptJobs.id });

  return {
    mediaAssetId: recording.mediaAssetId,
    meetingId: recording.meetingId,
    objectKey: recording.objectKey,
    recordingId: recording.recordingId,
    transcriptJobId: job.id,
  };
}

async function queueLocalRecorderTranscription(
  input: LocalRecorderTranscriptionEventInput,
) {
  await inngest.send(buildLocalRecorderTranscriptionEvent(input));
}

function normalizeLocalRecorderFileSizeBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

async function getUploadableLocalRecorderAttempt(input: {
  clientRecordingId: string;
  deviceId: string;
  fallbackIntentId: string;
  recordingStartedAt: Date;
  workspace: WorkspaceContext;
}) {
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

  return attempt;
}

async function getStartedLocalRecorderAttempt(input: {
  deviceId: string;
  fallbackIntentId: string;
  workspace: WorkspaceContext;
}) {
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

  if (
    !attempt ||
    attempt.expiresAt < new Date() ||
    attempt.attemptState !== "started"
  ) {
    throw new LocalRecorderUploadError("No active local recording intent");
  }

  return attempt;
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

function createLocalRecorderAssetIds(): LocalRecorderUploadAssetIds {
  return {
    computerAudioAssetId: crypto.randomUUID(),
    microphoneAudioAssetId: crypto.randomUUID(),
    synthesizedAudioAssetId: crypto.randomUUID(),
  };
}

function buildLocalRecorderObjectKeys(input: {
  assetIds: LocalRecorderUploadAssetIds;
  meetingId: string;
  teamId: string;
}) {
  return {
    computerAudioKey: buildMeetingObjectKey({
      assetId: input.assetIds.computerAudioAssetId,
      extension: "wav",
      meetingId: input.meetingId,
      teamId: input.teamId,
    }),
    microphoneAudioKey: buildMeetingObjectKey({
      assetId: input.assetIds.microphoneAudioAssetId,
      extension: "wav",
      meetingId: input.meetingId,
      teamId: input.teamId,
    }),
    synthesizedAudioKey: buildMeetingObjectKey({
      assetId: input.assetIds.synthesizedAudioAssetId,
      extension: "wav",
      meetingId: input.meetingId,
      teamId: input.teamId,
    }),
  };
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

function getSdkUploadId(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new LocalRecorderUploadError("Recall Desktop SDK upload is invalid");
  }

  const id = (value as { id?: unknown }).id;

  if (typeof id !== "string" || !id.trim()) {
    throw new LocalRecorderUploadError("Recall Desktop SDK upload is invalid");
  }

  return id.trim();
}

function getSdkUploadToken(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new LocalRecorderUploadError("Recall Desktop SDK upload is invalid");
  }

  const uploadToken = (value as { upload_token?: unknown; uploadToken?: unknown })
    .upload_token ?? (value as { uploadToken?: unknown }).uploadToken;

  if (typeof uploadToken !== "string" || !uploadToken.trim()) {
    throw new LocalRecorderUploadError("Recall Desktop SDK upload is invalid");
  }

  return uploadToken.trim();
}
