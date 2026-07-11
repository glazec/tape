import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createRecallDesktopSdkUpload,
  db,
  getObjectMetadata,
  inngestSend,
  retrieveRecallBot,
} = vi.hoisted(() => ({
    createRecallDesktopSdkUpload: vi.fn(),
    db: {
      insert: vi.fn(),
      select: vi.fn(),
      transaction: vi.fn(),
      update: vi.fn(),
    },
    getObjectMetadata: vi.fn(),
    inngestSend: vi.fn(),
    retrieveRecallBot: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db,
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: inngestSend,
  },
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    getObjectMetadata,
    parseR2Env: () => ({ R2_BUCKET: "meeting-audio" }),
  };
});

vi.mock("@/lib/vendors/recall", () => ({
  createRecallDesktopSdkUpload,
  getRecallApiBaseUrl: () => "https://us-east-1.recall.ai",
  retrieveRecallBot,
}));

import {
  buildLocalRecorderTranscriptionEvent,
  completeLocalRecorderRecordingUpload,
  createRecallDesktopSdkUploadForLocalRecorder,
  getLocalRecorderMonitoringStatus,
  isRecallDesktopSdkFallbackIntent,
  isLocalRecorderCandidateVisibleInLookup,
  isLocalRecorderMonitoringMeetingCurrent,
  isLocalRecorderPrimaryClaimConflict,
  listMissedLocalRecorderMeetings,
  markRecallDesktopSdkFallback,
} from "@/lib/local-recorder-records";

function selectRows(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn(() => chain),
    where: vi.fn(() => chain),
  };

  return chain;
}

describe("local recorder records", () => {
  afterEach(() => {
    db.insert.mockReset();
    db.select.mockReset();
    db.transaction.mockReset();
    db.update.mockReset();
    createRecallDesktopSdkUpload.mockReset();
    getObjectMetadata.mockReset();
    inngestSend.mockReset();
    retrieveRecallBot.mockReset();
  });

  it("creates a Recall Desktop SDK upload for a valid local recorder intent", async () => {
    db.select.mockReturnValueOnce(
      selectRows([
        {
          attemptState: "started",
          expiresAt: new Date(Date.now() + 60_000),
          id: "44444444-4444-4444-8444-444444444444",
          meetingId: "22222222-2222-4222-8222-222222222222",
        },
      ]),
    );
    createRecallDesktopSdkUpload.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      upload_token: "recall_upload_token_123",
    });

    await expect(
      createRecallDesktopSdkUploadForLocalRecorder({
        clientRecordingId: "client_recording_123",
        deviceId: "device_123",
        fallbackIntentId: "intent_123",
        requestUrl: "https://app.example.com/api/local-recorder/recordings/sdk-upload",
        workspace: {
          canCreateMeetings: true,
          domain: "",
          teamId: "team_123",
          userId: "user_123",
        },
      }),
    ).resolves.toEqual({
      fallbackIntentId: "intent_123",
      meetingId: "22222222-2222-4222-8222-222222222222",
      recallApiUrl: "https://us-east-1.recall.ai",
      sdkUploadId: "33333333-3333-4333-8333-333333333333",
      uploadToken: "recall_upload_token_123",
    });
    expect(createRecallDesktopSdkUpload).toHaveBeenCalledWith({
      metadata: {
        clientRecordingId: "client_recording_123",
        fallbackIntentId: "intent_123",
        meetingId: "22222222-2222-4222-8222-222222222222",
        source: "local_recorder_sdk",
        teamId: "team_123",
        userId: "user_123",
      },
      webhookUrl:
        "https://app.example.com/api/local-recorder/recordings/sdk-upload",
    });
  });

  it("marks and recognizes an SDK intent that switched to local capture", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    db.select
      .mockReturnValueOnce(selectRows([{ id: "attempt_123" }]))
      .mockReturnValueOnce(
        selectRows([{ notificationState: "recall_sdk_fallback" }]),
      );
    db.update.mockReturnValue({ set: updateSet });

    await expect(
      markRecallDesktopSdkFallback({
        deviceId: "device_123",
        fallbackIntentId: "intent_123",
        workspace: {
          canCreateMeetings: true,
          domain: "",
          teamId: "team_123",
          userId: "user_123",
        },
      }),
    ).resolves.toEqual({ marked: true });
    await expect(
      isRecallDesktopSdkFallbackIntent("intent_123"),
    ).resolves.toBe(true);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ notificationState: "recall_sdk_fallback" }),
    );
  });

  it("builds a deterministic transcription event for completion retries", () => {
    expect(
      buildLocalRecorderTranscriptionEvent({
        mediaAssetId: "11111111-1111-4111-8111-111111111111",
        meetingId: "22222222-2222-4222-8222-222222222222",
        objectKey:
          "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/11111111-1111-4111-8111-111111111111.wav",
        transcriptJobId: "33333333-3333-4333-8333-333333333333",
      }),
    ).toEqual({
      id: "local-recorder-transcribe-33333333-3333-4333-8333-333333333333",
      name: "meeting/transcribe.audio",
      data: {
        mediaAssetId: "11111111-1111-4111-8111-111111111111",
        meetingId: "22222222-2222-4222-8222-222222222222",
        objectKey:
          "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/11111111-1111-4111-8111-111111111111.wav",
        transcriptJobId: "33333333-3333-4333-8333-333333333333",
      },
    });
  });

  it("detects concurrent primary local recorder claim conflicts", () => {
    expect(
      isLocalRecorderPrimaryClaimConflict({
        code: "23505",
        constraint: "local_recording_attempts_primary_active_unique",
      }),
    ).toBe(true);
    expect(
      isLocalRecorderPrimaryClaimConflict({
        code: "23505",
        constraint: "other_unique_index",
      }),
    ).toBe(false);
  });

  it("completes uploaded local recorder rows without a database transaction", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const insertMediaOnConflictDoNothing = vi
      .fn()
      .mockResolvedValue(undefined);
    const insertMediaValues = vi.fn(() => ({
      onConflictDoNothing: insertMediaOnConflictDoNothing,
    }));
    const recordingReturning = vi
      .fn()
      .mockResolvedValue([{ id: "55555555-5555-4555-8555-555555555555" }]);
    const recordingOnConflictDoUpdate = vi.fn(() => ({
      returning: recordingReturning,
    }));
    const insertRecordingValues = vi.fn(() => ({
      onConflictDoUpdate: recordingOnConflictDoUpdate,
    }));
    const jobReturning = vi
      .fn()
      .mockResolvedValue([{ id: "66666666-6666-4666-8666-666666666666" }]);
    const insertJobValues = vi.fn(() => ({ returning: jobReturning }));

    db.transaction.mockRejectedValue(new Error("transactions are unavailable"));
    db.update.mockReturnValue({ set: updateSet });
    db.insert
      .mockReturnValueOnce({ values: insertMediaValues })
      .mockReturnValueOnce({ values: insertRecordingValues })
      .mockReturnValueOnce({ values: insertJobValues });
    db.select
      .mockReturnValueOnce(
        selectRows([
          {
            attemptState: "uploading",
            expiresAt: new Date("2026-07-01T13:00:00.000Z"),
            id: "44444444-4444-4444-8444-444444444444",
            meetingId: "22222222-2222-4222-8222-222222222222",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(
        selectRows([
          {
            mediaAssetId: "33333333-3333-4333-8333-333333333333",
            meetingId: "22222222-2222-4222-8222-222222222222",
            objectKey:
              "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/33333333-3333-4333-8333-333333333333.wav",
            transcriptJobId: null,
          },
        ]),
      );
    getObjectMetadata.mockResolvedValue({
      contentLength: 192044,
      contentType: "audio/wav",
    });

    await expect(
      completeLocalRecorderRecordingUpload({
        assets: {
          computerAudioAssetId: "11111111-1111-4111-8111-111111111111",
          microphoneAudioAssetId: "22222222-2222-4222-8222-222222222222",
          synthesizedAudioAssetId: "33333333-3333-4333-8333-333333333333",
        },
        clientRecordingId: "client_recording_123",
        deviceId: "device_123",
        fallbackIntentId: "intent_123",
        manifest: { appVersion: "0.1.0" },
        recordingStartedAt: new Date("2026-07-01T12:00:00.000Z"),
        recordingStoppedAt: new Date("2026-07-01T12:01:00.000Z"),
        workspace: {
          canCreateMeetings: true,
          domain: "",
          teamId: "team_123",
          userId: "user_123",
        },
      }),
    ).resolves.toEqual({
      localRecordingId: "55555555-5555-4555-8555-555555555555",
      meetingId: "22222222-2222-4222-8222-222222222222",
      queued: true,
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(insertMediaValues).toHaveBeenCalledOnce();
    expect(insertMediaOnConflictDoNothing).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attemptState: "uploaded" }),
    );
    expect(updateSet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endedAt: new Date("2026-07-01T12:01:00.000Z"),
        status: "processing",
      }),
    );
    expect(updateWhere).toHaveBeenCalledTimes(2);
    expect(inngestSend).toHaveBeenCalledOnce();
  });

  it("excludes future and unscheduled meetings from the missed recorder lookup", () => {
    const now = new Date("2026-07-01T12:00:00.000Z");

    expect(
      isLocalRecorderCandidateVisibleInLookup({
        now,
        startedAt: new Date("2026-07-01T11:58:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isLocalRecorderCandidateVisibleInLookup({
        now,
        startedAt: new Date("2026-07-01T12:10:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isLocalRecorderCandidateVisibleInLookup({
        now,
        startedAt: null,
      }),
    ).toBe(false);
  });

  it("detects scheduled meetings that are currently in their time window", () => {
    const now = new Date("2026-07-01T14:00:00.000Z");

    expect(
      isLocalRecorderMonitoringMeetingCurrent({
        endedAt: new Date("2026-07-01T16:30:00.000Z"),
        now,
        startedAt: new Date("2026-07-01T12:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isLocalRecorderMonitoringMeetingCurrent({
        endedAt: null,
        now,
        startedAt: new Date("2026-07-01T12:00:00.000Z"),
      }),
    ).toBe(true);
    expect(
      isLocalRecorderMonitoringMeetingCurrent({
        endedAt: new Date("2026-07-01T13:00:00.000Z"),
        now,
        startedAt: new Date("2026-07-01T12:00:00.000Z"),
      }),
    ).toBe(false);
    expect(
      isLocalRecorderMonitoringMeetingCurrent({
        endedAt: new Date("2026-07-01T16:30:00.000Z"),
        now,
        startedAt: new Date("2026-07-01T15:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("does not notify fallback when Recall says the bot is already in call", async () => {
    const deviceOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const deviceValues = vi.fn(() => ({
      onConflictDoUpdate: deviceOnConflictDoUpdate,
    }));
    const attemptValues = vi.fn();

    db.insert
      .mockReturnValueOnce({ values: deviceValues })
      .mockReturnValueOnce({ values: attemptValues });
    db.select
      .mockReturnValueOnce(
        selectRows([
          {
            activeTranscriptJob: false,
            endedAt: new Date("2026-07-01T12:30:00.000Z"),
            id: "meeting_123",
            meetingUrl: "https://meet.google.com/abc-defg-hij",
            recallAudioAsset: false,
            recallBotId: "bot_123",
            recallRecordingId: null,
            startedAt: new Date("2026-07-01T12:00:00.000Z"),
            status: "scheduled",
            title: "Weekly sync",
          },
        ]),
      )
      .mockReturnValueOnce(selectRows([]));
    retrieveRecallBot.mockResolvedValue({
      status_changes: [
        {
          code: "in_call",
          sub_code: null,
        },
      ],
    });

    await expect(
      listMissedLocalRecorderMeetings({
        deviceId: "mac_123",
        now: new Date("2026-07-01T12:02:00.000Z"),
        workspace: {
          canCreateMeetings: true,
          domain: "",
          teamId: "team_123",
          userId: "user_123",
        },
      }),
    ).resolves.toEqual([]);
    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(attemptValues).not.toHaveBeenCalled();
  });

  it("returns the next monitored meeting with the bot status", async () => {
    const deviceOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const deviceValues = vi.fn(() => ({
      onConflictDoUpdate: deviceOnConflictDoUpdate,
    }));

    db.insert.mockReturnValueOnce({ values: deviceValues });
    db.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(
        selectRows([
          {
            endedAt: new Date("2026-07-01T12:30:00.000Z"),
            id: "meeting_123",
            recallBotId: "bot_123",
            recallRecordingId: null,
            startedAt: new Date("2026-07-01T12:10:00.000Z"),
            status: "scheduled",
            title: "Weekly sync",
          },
        ]),
      );

    await expect(
      getLocalRecorderMonitoringStatus({
        deviceId: "mac_123",
        now: new Date("2026-07-01T12:00:00.000Z"),
        workspace: {
          canCreateMeetings: true,
          domain: "",
          teamId: "team_123",
          userId: "user_123",
        },
      }),
    ).resolves.toEqual({
      missedMeetings: [],
      nextMeeting: {
        botStatus: "planned",
        botStatusDetail: "Bot is scheduled",
        botStatusLabel: "Planned",
        endsAt: "2026-07-01T12:30:00.000Z",
        meetingId: "meeting_123",
        startsAt: "2026-07-01T12:10:00.000Z",
        title: "Weekly sync",
      },
    });
    expect(deviceValues).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSeenAt: new Date("2026-07-01T12:00:00.000Z"),
        teamId: "team_123",
        userId: "user_123",
      }),
    );
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});
