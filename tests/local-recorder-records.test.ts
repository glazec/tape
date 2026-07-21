import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createRecallDesktopSdkUpload,
  createUploadUrl,
  db,
  getObjectMetadata,
  inngestSend,
  retrieveRecallBot,
  reconcileMeetingSharingForMeeting,
} = vi.hoisted(() => ({
    createRecallDesktopSdkUpload: vi.fn(),
    createUploadUrl: vi.fn(),
    db: {
      insert: vi.fn(),
      select: vi.fn(),
      transaction: vi.fn(),
      update: vi.fn(),
    },
    getObjectMetadata: vi.fn(),
    inngestSend: vi.fn(),
    retrieveRecallBot: vi.fn(),
    reconcileMeetingSharingForMeeting: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db,
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: inngestSend,
  },
}));

vi.mock("@/lib/meeting-share-rules", () => ({
  reconcileMeetingSharingForMeeting,
}));

vi.mock("@/lib/r2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/r2")>();

  return {
    ...actual,
    createUploadUrl,
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
  claimLocalRecorderIntent,
  createManualLocalRecorderIntent,
  createRecallDesktopSdkUploadForLocalRecorder,
  failLocalRecorderIntent,
  getLocalRecorderMonitoringStatus,
  isRecallDesktopSdkFallbackIntent,
  isLocalRecorderCandidateVisibleInLookup,
  isLocalRecorderMonitoringMeetingCurrent,
  isLocalRecorderPrimaryClaimConflict,
  listMissedLocalRecorderMeetings,
  markRecallDesktopSdkFallback,
  prepareLocalRecorderRecordingUpload,
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
    createUploadUrl.mockReset();
    getObjectMetadata.mockReset();
    inngestSend.mockReset();
    retrieveRecallBot.mockReset();
    reconcileMeetingSharingForMeeting.mockReset();
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

  it("creates one fallback intent for an eligible missed meeting", async () => {
    const deviceConflict = vi.fn().mockResolvedValue(undefined);
    const attemptValues = vi.fn().mockResolvedValue(undefined);
    db.insert
      .mockReturnValueOnce({
        values: vi.fn(() => ({ onConflictDoUpdate: deviceConflict })),
      })
      .mockReturnValueOnce({ values: attemptValues });
    db.select
      .mockReturnValueOnce(selectRows([{
        activeTranscriptJob: false,
        endedAt: new Date("2026-07-01T12:30:00.000Z"),
        id: "meeting_123",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        recallAudioAsset: false,
        recallBotId: null,
        recallRecordingId: null,
        startedAt: new Date("2026-07-01T12:00:00.000Z"),
        status: "scheduled",
        title: "Weekly sync",
      }]))
      .mockReturnValueOnce(selectRows([]));

    const result = await listMissedLocalRecorderMeetings({
      deviceId: "mac_123",
      now: new Date("2026-07-01T12:02:00.000Z"),
      workspace: workspace(),
    });

    expect(result).toEqual([
      expect.objectContaining({
        displayTimeWindow: {
          endsAt: "2026-07-01T12:30:00.000Z",
          startsAt: "2026-07-01T12:00:00.000Z",
        },
        title: "Weekly sync",
      }),
    ]);
    expect(attemptValues).toHaveBeenCalledWith(expect.objectContaining({
      attemptState: "notified",
      meetingId: "meeting_123",
      notificationState: "shown",
    }));
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
        appVersion: "0.2.0+abc123",
        deviceId: "mac_123",
        now: new Date("2026-07-01T12:00:00.000Z"),
        permissionReadiness: {
          microphone: "granted",
          notifications: "granted",
          screenCapture: "granted",
          startAtLogin: "granted",
        },
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
        appVersion: "0.2.0+abc123",
        lastSeenAt: new Date("2026-07-01T12:00:00.000Z"),
        permissionReadiness: {
          microphone: "granted",
          notifications: "granted",
          screenCapture: "granted",
          startAtLogin: "granted",
        },
        teamId: "team_123",
        userId: "user_123",
      }),
    );
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["cancelled", "bot_1", null, "cancelled", "Cancelled", "Meeting was cancelled"],
    ["failed", "bot_1", null, "failed", "Failed", "Bot could not record"],
    ["processing", "bot_1", null, "done", "Done", "Bot recording finished"],
    ["scheduled", null, null, "not_planned", "Not planned", "No bot is scheduled"],
    ["recording", null, null, "not_planned", "Not planned", "No bot is scheduled"],
    ["recording", "bot_1", null, "joined", "Joined", "Bot joined the call"],
    ["recording", "bot_1", "rec_1", "recording", "Recording", "Bot is recording"],
    ["scheduled", "bot_1", null, "in_meeting_room", "In meeting room", "Bot is waiting or joining"],
  ])("reports %s meetings as %s", async (
    status,
    recallBotId,
    recallRecordingId,
    botStatus,
    botStatusLabel,
    botStatusDetail,
  ) => {
    db.insert.mockReturnValueOnce({
      values: vi.fn(() => ({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) })),
    });
    db.select
      .mockReturnValueOnce(selectRows([]))
      .mockReturnValueOnce(selectRows([{
        endedAt: new Date("2026-07-20T12:30:00.000Z"),
        id: "meeting_1",
        recallBotId,
        recallRecordingId,
        startedAt: new Date("2026-07-20T12:00:00.000Z"),
        status,
        title: "Status meeting",
      }]));

    const result = await getLocalRecorderMonitoringStatus({
      deviceId: "mac_1",
      now: new Date("2026-07-20T12:05:00.000Z"),
      workspace: workspace(),
    });

    expect(result.nextMeeting).toEqual(expect.objectContaining({
      botStatus,
      botStatusDetail,
      botStatusLabel,
    }));
  });

  it("fails the intent and moves a still-recording meeting to failed", async () => {
    db.select.mockReturnValueOnce(
      selectRows([{ id: "attempt_1", meetingId: "meeting_1" }]),
    );
    const setCalls: unknown[] = [];
    db.update.mockImplementation(() => ({
      set: (values: unknown) => {
        setCalls.push(values);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }));

    await expect(
      failLocalRecorderIntent({
        deviceId: "mac_123",
        errorMessage: "capture failed",
        fallbackIntentId: "intent_123",
        now: new Date("2026-07-11T18:00:00.000Z"),
        workspace: {
          canCreateMeetings: true,
          domain: "",
          teamId: "team_123",
          userId: "user_123",
        },
      }),
    ).resolves.toEqual({ failed: true });

    expect(setCalls).toEqual([
      {
        attemptState: "failed",
        errorMessage: "capture failed",
        updatedAt: new Date("2026-07-11T18:00:00.000Z"),
      },
      {
        status: "failed",
        updatedAt: new Date("2026-07-11T18:00:00.000Z"),
      },
    ]);
  });

  it("claims an eligible recorder intent", async () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    db.select
      .mockReturnValueOnce(selectRows([{
        activeTranscriptJob: false,
        endedAt: new Date("2026-07-20T12:30:00.000Z"),
        expiresAt: new Date("2026-07-20T13:00:00.000Z"),
        id: "attempt_1",
        meetingId: "meeting_1",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        recallAudioAsset: false,
        recallRecordingId: null,
        startedAt: new Date("2026-07-20T11:55:00.000Z"),
        status: "scheduled",
        title: "Weekly sync",
      }]))
      .mockReturnValueOnce(selectRows([]));
    db.update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    });

    await expect(claimLocalRecorderIntent({
      deviceId: "mac_1",
      fallbackIntentId: "intent_1",
      now,
      workspace: workspace(),
    })).resolves.toEqual({ claimed: true, meetingTitle: "Weekly sync" });
  });

  it("rejects missing and competing recorder claims", async () => {
    db.select.mockReturnValueOnce(selectRows([]));
    await expect(claimLocalRecorderIntent({
      deviceId: "mac_1",
      fallbackIntentId: "intent_1",
      now: new Date("2026-07-20T12:00:00.000Z"),
      workspace: workspace(),
    })).resolves.toEqual({ claimed: false, reason: "expired_or_missing" });

    db.select
      .mockReturnValueOnce(selectRows([{
        activeTranscriptJob: false,
        endedAt: null,
        expiresAt: new Date("2026-07-20T13:00:00.000Z"),
        id: "attempt_1",
        meetingId: "meeting_1",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        recallAudioAsset: false,
        recallRecordingId: null,
        startedAt: new Date("2026-07-20T11:55:00.000Z"),
        status: "scheduled",
        title: "Meeting",
      }]))
      .mockReturnValueOnce(selectRows([{ id: "attempt_2" }]));
    await expect(claimLocalRecorderIntent({
      deviceId: "mac_1",
      fallbackIntentId: "intent_1",
      now: new Date("2026-07-20T12:01:00.000Z"),
      workspace: workspace(),
    })).resolves.toEqual({ claimed: false, reason: "already_recording" });
  });

  it("recommends an ad hoc recording for an automatic claim outside the meeting window", async () => {
    db.select.mockReturnValueOnce(selectRows([{
      activeTranscriptJob: false,
      endedAt: null,
      expiresAt: new Date("2026-07-20T13:00:00.000Z"),
      id: "attempt_1",
      meetingId: "meeting_1",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      recallAudioAsset: false,
      recallRecordingId: null,
      startedAt: new Date("2026-07-20T11:00:00.000Z"),
      status: "scheduled",
      title: "Past meeting",
    }]));

    await expect(claimLocalRecorderIntent({
      deviceId: "mac_1",
      explicit: false,
      fallbackIntentId: "intent_1",
      now: new Date("2026-07-20T12:00:00.000Z"),
      workspace: workspace(),
    })).resolves.toEqual({ claimed: false, reason: "ad_hoc_recommended" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("turns a concurrent claim constraint into an already recording result", async () => {
    db.select
      .mockReturnValueOnce(selectRows([eligibleAttempt()]))
      .mockReturnValueOnce(selectRows([]));
    db.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn().mockRejectedValue({
          code: "23505",
          constraint: "local_recording_attempts_primary_active_unique",
        }),
      })),
    });

    await expect(claimLocalRecorderIntent({
      deviceId: "mac_1",
      fallbackIntentId: "intent_1",
      now: new Date("2026-07-20T12:00:00.000Z"),
      workspace: workspace(),
    })).resolves.toEqual({ claimed: false, reason: "already_recording" });
  });

  it("returns missing when failing an unknown intent", async () => {
    db.select.mockReturnValueOnce(selectRows([]));

    await expect(failLocalRecorderIntent({
      deviceId: "mac_1",
      errorMessage: null,
      fallbackIntentId: "intent_1",
      now: new Date("2026-07-20T12:00:00.000Z"),
      workspace: workspace(),
    })).resolves.toEqual({ failed: false, reason: "expired_or_missing" });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("prepares three direct upload URLs for a valid recording", async () => {
    db.select
      .mockReturnValueOnce(selectRows([{
        attemptState: "started",
        expiresAt: new Date("2026-07-20T13:00:00.000Z"),
        id: "attempt_1",
        meetingId: "meeting_1",
      }]))
      .mockReturnValueOnce(selectRows([]));
    db.update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    });
    createUploadUrl
      .mockResolvedValueOnce("https://upload/computer")
      .mockResolvedValueOnce("https://upload/microphone")
      .mockResolvedValueOnce("https://upload/synthesized");

    const result = await prepareLocalRecorderRecordingUpload({
      clientRecordingId: "recording_1",
      deviceId: "mac_1",
      fallbackIntentId: "intent_1",
      manifest: {},
      recordingStartedAt: new Date("2026-07-20T12:00:00.000Z"),
      recordingStoppedAt: new Date("2026-07-20T12:10:00.000Z"),
      workspace: workspace(),
    });

    expect(result.assets.computerAudio.uploadUrl).toBe("https://upload/computer");
    expect(result.assets.microphoneAudio.uploadUrl).toBe("https://upload/microphone");
    expect(result.assets.synthesizedAudio.uploadUrl).toBe("https://upload/synthesized");
    expect(createUploadUrl).toHaveBeenCalledTimes(3);
  });

  it("rejects preparing a recording that was already uploaded", async () => {
    db.select
      .mockReturnValueOnce(selectRows([uploadableAttempt()]))
      .mockReturnValueOnce(selectRows([{ id: "recording_1", meetingId: "meeting_1" }]));

    await expect(
      prepareLocalRecorderRecordingUpload(recordingUploadInput()),
    ).rejects.toThrow("Local recording already uploaded");
    expect(createUploadUrl).not.toHaveBeenCalled();
  });

  it("requeues transcription when upload completion is retried", async () => {
    db.select
      .mockReturnValueOnce(selectRows([uploadableAttempt()]))
      .mockReturnValueOnce(selectRows([{ id: "recording_1", meetingId: "meeting_1" }]))
      .mockReturnValueOnce(selectRows([{
        mediaAssetId: "asset_3",
        meetingId: "meeting_1",
        objectKey: "teams/team_123/meetings/meeting_1/assets/asset_3.wav",
        transcriptJobId: "job_1",
      }]));
    inngestSend.mockResolvedValue(undefined);

    await expect(
      completeLocalRecorderRecordingUpload(recordingUploadInput()),
    ).resolves.toEqual({
      localRecordingId: "recording_1",
      meetingId: "meeting_1",
      queued: true,
    });
    expect(inngestSend).toHaveBeenCalledWith(expect.objectContaining({
      id: "local-recorder-transcribe-job_1",
    }));
    expect(getObjectMetadata).not.toHaveBeenCalled();
  });

  it("rejects an upload retry attached to another meeting", async () => {
    db.select
      .mockReturnValueOnce(selectRows([uploadableAttempt()]))
      .mockReturnValueOnce(selectRows([{ id: "recording_1", meetingId: "meeting_2" }]));

    await expect(
      completeLocalRecorderRecordingUpload(recordingUploadInput()),
    ).rejects.toThrow("Local recording already belongs to another meeting");
    expect(inngestSend).not.toHaveBeenCalled();
  });

  it("reports missing audio when an uploaded object cannot be read", async () => {
    db.select
      .mockReturnValueOnce(selectRows([uploadableAttempt()]))
      .mockReturnValueOnce(selectRows([]));
    getObjectMetadata.mockRejectedValue(new Error("not found"));

    await expect(
      completeLocalRecorderRecordingUpload(recordingUploadInput()),
    ).rejects.toThrow("Uploaded local recording audio not found");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects malformed Recall SDK upload responses", async () => {
    db.select
      .mockReturnValueOnce(selectRows([{
        attemptState: "started",
        expiresAt: new Date(Date.now() + 60_000),
        id: "attempt_1",
        meetingId: "meeting_1",
      }]))
      .mockReturnValueOnce(selectRows([{
        attemptState: "started",
        expiresAt: new Date(Date.now() + 60_000),
        id: "attempt_1",
        meetingId: "meeting_1",
      }]));
    createRecallDesktopSdkUpload
      .mockResolvedValueOnce({ upload_token: "token" })
      .mockResolvedValueOnce({ id: "upload_1" });
    const input = {
      clientRecordingId: "recording_1",
      deviceId: "mac_1",
      fallbackIntentId: "intent_1",
      requestUrl: "https://app.example.com/webhook",
      workspace: workspace(),
    };

    await expect(
      createRecallDesktopSdkUploadForLocalRecorder(input),
    ).rejects.toThrow("Recall Desktop SDK upload is invalid");
    await expect(
      createRecallDesktopSdkUploadForLocalRecorder(input),
    ).rejects.toThrow("Recall Desktop SDK upload is invalid");
  });

  it("creates a manual recording and its claim intent", async () => {
    const deviceConflict = vi.fn().mockResolvedValue(undefined);
    const attemptValues = vi.fn().mockResolvedValue(undefined);
    db.insert
      .mockReturnValueOnce({ values: vi.fn(() => ({ onConflictDoUpdate: deviceConflict })) })
      .mockReturnValueOnce({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: "meeting_1", title: "Manual recording" }]) })) })
      .mockReturnValueOnce({ values: attemptValues });

    const result = await createManualLocalRecorderIntent({
      deviceId: "mac_1",
      now: new Date("2026-07-20T12:00:00.000Z"),
      title: "   ",
      workspace: workspace(),
    });

    expect(result.meetingTitle).toBe("Manual recording");
    expect(result.fallbackIntentId).toBeTruthy();
    expect(reconcileMeetingSharingForMeeting).toHaveBeenCalledWith("meeting_1");
    expect(attemptValues).toHaveBeenCalled();
  });
});

function workspace() {
  return {
    canCreateMeetings: true,
    domain: "",
    teamId: "team_123",
    userId: "user_123",
  };
}

function eligibleAttempt() {
  return {
    activeTranscriptJob: false,
    endedAt: new Date("2026-07-20T12:30:00.000Z"),
    expiresAt: new Date("2026-07-20T13:00:00.000Z"),
    id: "attempt_1",
    meetingId: "meeting_1",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    recallAudioAsset: false,
    recallRecordingId: null,
    startedAt: new Date("2026-07-20T11:55:00.000Z"),
    status: "scheduled",
    title: "Weekly sync",
  };
}

function uploadableAttempt() {
  return {
    attemptState: "uploading",
    expiresAt: new Date("2026-07-20T13:00:00.000Z"),
    id: "attempt_1",
    meetingId: "meeting_1",
  };
}

function recordingUploadInput() {
  return {
    assets: {
      computerAudioAssetId: "asset_1",
      microphoneAudioAssetId: "asset_2",
      synthesizedAudioAssetId: "asset_3",
    },
    clientRecordingId: "recording_1",
    deviceId: "mac_1",
    fallbackIntentId: "intent_1",
    manifest: {},
    recordingStartedAt: new Date("2026-07-20T12:00:00.000Z"),
    recordingStoppedAt: new Date("2026-07-20T12:10:00.000Z"),
    workspace: workspace(),
  };
}
