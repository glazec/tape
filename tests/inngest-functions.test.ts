import { afterEach, describe, expect, it, vi } from "vitest";

const {
  assertMeetingHasProviderCredit,
  assertWorkspaceHasProviderCredit,
  createElevenLabsTranscriptJob,
  completeUploadedVideoConversion,
  convertVideoObjectToAudio,
  createReadUrl,
  deleteScheduledRecallBot,
  dispatchPendingLocationReminderSchedules,
  getMeetingVocabularyKeyterms,
  getTranscriptJobDurationMs,
  markLocationReminderDeliveryFailed,
  scheduleRecallBot,
  sendScheduledLocationReminder,
  stopBotsForExhaustedWorkspaces,
  syncRecallCalendarEventsForAllConnectedUsers,
  update,
} = vi.hoisted(() => ({
  assertMeetingHasProviderCredit: vi.fn(),
  assertWorkspaceHasProviderCredit: vi.fn(),
  createElevenLabsTranscriptJob: vi.fn(),
  completeUploadedVideoConversion: vi.fn(),
  convertVideoObjectToAudio: vi.fn(),
  createReadUrl: vi.fn(),
  deleteScheduledRecallBot: vi.fn(),
  dispatchPendingLocationReminderSchedules: vi.fn(),
  getMeetingVocabularyKeyterms: vi.fn().mockResolvedValue([]),
  getTranscriptJobDurationMs: vi.fn().mockResolvedValue(30 * 60 * 1_000),
  markLocationReminderDeliveryFailed: vi.fn(),
  scheduleRecallBot: vi.fn(),
  sendScheduledLocationReminder: vi.fn(),
  stopBotsForExhaustedWorkspaces: vi.fn(),
  syncRecallCalendarEventsForAllConnectedUsers: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/provider-credit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-credit")>()),
  assertMeetingHasProviderCredit,
  assertWorkspaceHasProviderCredit,
}));

vi.mock("@/db/client", () => ({
  db: {
    update,
  },
}));

vi.mock("@/lib/r2", () => ({
  createReadUrl,
}));

vi.mock("@/lib/media-conversion", () => ({
  convertVideoObjectToAudio,
}));

vi.mock("@/lib/transcription-records", () => ({
  completeUploadedVideoConversion,
}));

vi.mock("@/lib/vendors/elevenlabs", () => ({
  createElevenLabsTranscriptJob,
}));

vi.mock("@/lib/vendors/recall", () => ({
  deleteScheduledRecallBot,
  scheduleRecallBot,
}));

vi.mock("@/lib/recall-calendar-bulk-sync", () => ({
  syncRecallCalendarEventsForAllConnectedUsers,
}));

vi.mock("@/lib/provider-credit-enforcement", () => ({
  stopBotsForExhaustedWorkspaces,
}));

vi.mock("@/lib/location-reminders", () => ({
  dispatchPendingLocationReminderSchedules,
  markLocationReminderDeliveryFailed,
  sendScheduledLocationReminder,
}));

vi.mock("@/lib/team-vocabulary", () => ({
  getMeetingVocabularyKeyterms,
}));

vi.mock("@/lib/transcription-duration", () => ({
  getTranscriptJobDurationMs,
}));

type RunnableInngestFunction = {
  fn: (input?: unknown) => Promise<unknown>;
};

describe("Inngest functions", () => {
  afterEach(() => {
    vi.clearAllMocks();
    assertMeetingHasProviderCredit.mockReset();
    assertWorkspaceHasProviderCredit.mockReset();
    getTranscriptJobDurationMs.mockReset().mockResolvedValue(30 * 60 * 1_000);
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("registers non-calendar background workers", async () => {
    const { functions } = await import("@/inngest/functions");

    expect(
      functions.map((fn) => ({
        id: fn.opts.id,
        triggers: fn.opts.triggers,
      })),
    ).toEqual([
      {
        id: "schedule-meeting-bot",
        triggers: [{ event: "meeting/schedule.bot" }],
      },
      {
        id: "delete-recall-bot",
        triggers: [{ event: "meeting/delete.recall-bot" }],
      },
      {
        id: "transcribe-audio",
        triggers: [{ event: "meeting/transcribe.audio" }],
      },
      {
        id: "convert-video-to-audio",
        triggers: [{ event: "meeting/convert.video-to-audio" }],
      },
      {
        id: "enrich-transcript",
        triggers: [{ event: "meeting/enrich.transcript" }],
      },
      {
        id: "send-location-reminder",
        triggers: [{ event: "meeting/send.location-reminder" }],
      },
      {
        id: "reconcile-location-reminder-schedules",
        triggers: [
          { event: "meeting/reconcile.location-reminder-schedules" },
          { cron: "5 * * * *" },
        ],
      },
      {
        id: "sync-recall-calendars-hourly",
        triggers: [{ cron: "0 * * * *" }],
      },
      {
        id: "enforce-provider-credit",
        triggers: [{ cron: "*/5 * * * *" }],
      },
      {
        id: "reconcile-stale-meeting-jobs",
        triggers: [{ cron: "*/15 * * * *" }],
      },
    ]);
  });

  it("checks workspace credit before scheduling a background bot", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    scheduleRecallBot.mockResolvedValue({ id: "bot_123" });
    const { scheduleMeetingBot } = await import("@/inngest/functions");

    await expect(
      (scheduleMeetingBot as unknown as RunnableInngestFunction).fn({
        event: {
          data: {
            meetingUrl: "https://meet.google.com/abc-defg-hij",
            teamId: "11111111-1111-4111-8111-111111111111",
          },
        },
      }),
    ).resolves.toEqual({ id: "bot_123" });

    expect(assertWorkspaceHasProviderCredit).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(assertWorkspaceHasProviderCredit.mock.invocationCallOrder[0]).toBeLessThan(
      scheduleRecallBot.mock.invocationCallOrder[0],
    );
  });

  it("sleeps until the reminder schedule and then delivers it", async () => {
    const sleepUntil = vi.fn().mockResolvedValue(undefined);
    const run = vi
      .fn()
      .mockImplementation(
        async (_name: string, handler: () => Promise<unknown>) => handler(),
      );
    sendScheduledLocationReminder.mockResolvedValue({ action: "sent" });
    const { sendLocationReminder } = await import("@/inngest/functions");
    const data = {
      reminderId: "33333333-3333-4333-8333-333333333333",
      scheduleVersion: 2,
      scheduledFor: "2026-07-24T19:58:00.000Z",
    };

    await expect(
      (sendLocationReminder as unknown as RunnableInngestFunction).fn({
        attempt: 0,
        event: { data },
        step: { run, sleepUntil },
      }),
    ).resolves.toEqual({ action: "sent" });

    expect(sleepUntil).toHaveBeenCalledWith(
      "wait-for-location-reminder",
      new Date(data.scheduledFor),
    );
    expect(sendScheduledLocationReminder).toHaveBeenCalledWith(data);
  });

  it("marks a reminder failed only after the final delivery attempt", async () => {
    const error = new Error("OneSignal unavailable");
    const sleepUntil = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockRejectedValue(error);
    const { sendLocationReminder } = await import("@/inngest/functions");
    const data = {
      reminderId: "33333333-3333-4333-8333-333333333333",
      scheduleVersion: 2,
      scheduledFor: "2026-07-24T19:58:00.000Z",
    };

    await expect(
      (sendLocationReminder as unknown as RunnableInngestFunction).fn({
        attempt: 4,
        event: { data },
        step: { run, sleepUntil },
      }),
    ).rejects.toThrow("OneSignal unavailable");

    expect(markLocationReminderDeliveryFailed).toHaveBeenCalledWith({
      error,
      reminderId: data.reminderId,
      scheduleVersion: data.scheduleVersion,
    });
  });

  it("reconciles reminder schedules hourly and on demand", async () => {
    dispatchPendingLocationReminderSchedules.mockResolvedValue({
      dispatchedCount: 3,
    });
    const { reconcileLocationReminderSchedules } = await import(
      "@/inngest/functions"
    );

    await expect(
      (
        reconcileLocationReminderSchedules as unknown as RunnableInngestFunction
      ).fn(),
    ).resolves.toEqual({ dispatchedCount: 3 });
  });

  it("retries deletion of a displaced Recall bot", async () => {
    deleteScheduledRecallBot.mockResolvedValue({});
    const { deleteRecallBot } = await import("@/inngest/functions");

    await expect(
      (deleteRecallBot as unknown as RunnableInngestFunction).fn({
        event: { data: { botId: "scheduled_bot" } },
      }),
    ).resolves.toEqual({});
    expect(deleteScheduledRecallBot).toHaveBeenCalledWith({
      botId: "scheduled_bot",
    });
  });

  it("runs the hourly Recall Calendar repair sync", async () => {
    const syncResult = {
      connectionCount: 2,
      failedConnectionCount: 0,
      failures: [],
      syncedConnectionCount: 2,
      syncedEventCount: 7,
    };
    syncRecallCalendarEventsForAllConnectedUsers.mockResolvedValue(syncResult);

    const { syncRecallCalendarsHourly } = await import("@/inngest/functions");

    await expect(
      (syncRecallCalendarsHourly as unknown as RunnableInngestFunction).fn(),
    ).resolves.toEqual(syncResult);
    expect(syncRecallCalendarEventsForAllConnectedUsers).toHaveBeenCalledTimes(
      1,
    );
  });

  it("removes scheduled bots after provider credit is exhausted", async () => {
    const result = { failed: 0, stopped: 2 };
    stopBotsForExhaustedWorkspaces.mockResolvedValue(result);
    const { enforceProviderCredit } = await import("@/inngest/functions");

    await expect(
      (enforceProviderCredit as unknown as RunnableInngestFunction).fn(),
    ).resolves.toEqual(result);
    expect(stopBotsForExhaustedWorkspaces).toHaveBeenCalledOnce();
  });

  it("marks the transcript job failed when the final transcription attempt fails", async () => {
    const error = new Error(
      "ElevenLabs transcript job failed with 400 Bad Request",
    );
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set });
    createReadUrl.mockResolvedValue("https://cdn.example.com/audio.mp3");
    createElevenLabsTranscriptJob.mockRejectedValue(error);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");

    const { transcribeAudio } = await import("@/inngest/functions");

    await expect(
      (transcribeAudio as unknown as RunnableInngestFunction).fn({
        attempt: 4,
        event: {
          data: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            objectKey: "users/user_123/uploads/audio.mp3",
            transcriptJobId: "22222222-2222-4222-8222-222222222222",
          },
        },
      }),
    ).rejects.toThrow("ElevenLabs transcript job failed with 400 Bad Request");

    expect(set).toHaveBeenCalledWith({
      errorMessage: "ElevenLabs transcript job failed with 400 Bad Request",
      status: "failed",
      updatedAt: expect.any(Date),
    });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("does not start transcription after the workspace credit is exhausted", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set });
    const { ProviderCreditExhaustedError } = await import(
      "@/lib/provider-credit"
    );
    assertMeetingHasProviderCredit.mockRejectedValue(
      new ProviderCreditExhaustedError(5_000_000),
    );
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const { transcribeAudio } = await import("@/inngest/functions");

    await expect(
      (transcribeAudio as unknown as RunnableInngestFunction).fn({
        event: {
          data: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            objectKey: "users/user_123/uploads/audio.mp3",
            transcriptJobId: "22222222-2222-4222-8222-222222222222",
          },
        },
      }),
    ).resolves.toEqual({
      action: "skipped",
      reason: "credit_exhausted",
    });

    expect(createReadUrl).not.toHaveBeenCalled();
    expect(createElevenLabsTranscriptJob).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({
      errorMessage:
        "Your Tape credit has been used. You can still review existing meetings.",
      status: "failed",
      updatedAt: expect.any(Date),
    });
  });

  it("routes recordings over sixty minutes to the media worker", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const sendEvent = vi.fn().mockResolvedValue({ ids: ["chunk_event"] });
    update.mockReturnValue({ set });
    getTranscriptJobDurationMs.mockResolvedValue(61 * 60 * 1_000);
    getMeetingVocabularyKeyterms.mockResolvedValue(["IOSG"]);
    const { transcribeAudio } = await import("@/inngest/functions");
    const data = {
      meetingId: "11111111-1111-4111-8111-111111111111",
      objectKey: "users/user_123/uploads/long-audio.mp3",
      recordingId: "33333333-3333-4333-8333-333333333333",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    };

    await expect(
      (transcribeAudio as unknown as RunnableInngestFunction).fn({
        event: { data },
        step: { sendEvent },
      }),
    ).resolves.toEqual({ ids: ["chunk_event"] });

    expect(createReadUrl).not.toHaveBeenCalled();
    expect(createElevenLabsTranscriptJob).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({
      status: "running",
      updatedAt: expect.any(Date),
    });
    expect(sendEvent).toHaveBeenCalledWith("queue-chunked-transcription", {
      id: `chunked-transcription:${data.transcriptJobId}`,
      name: "meeting/transcribe.audio-in-chunks",
      data: { ...data, keyterms: ["IOSG"] },
    });
  });

  it("converts video to audio before queuing transcription", async () => {
    const send = vi.fn().mockResolvedValue({ ids: ["evt_789"] });
    convertVideoObjectToAudio.mockResolvedValue(undefined);
    completeUploadedVideoConversion.mockResolvedValue({
      meetingId: "22222222-2222-4222-8222-222222222222",
      mediaAssetId: "44444444-4444-4444-8444-444444444444",
      objectKey:
        "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
      transcriptJobId: "55555555-5555-4555-8555-555555555555",
    });

    const { convertVideoToAudio } = await import("@/inngest/functions");

    await expect(
      (convertVideoToAudio as unknown as RunnableInngestFunction).fn({
        event: {
          data: {
            meetingId: "22222222-2222-4222-8222-222222222222",
            sourceMediaAssetId: "33333333-3333-4333-8333-333333333333",
            sourceObjectKey: "users/user_123/uploads/video.mp4",
            audioMediaAssetId: "44444444-4444-4444-8444-444444444444",
            audioObjectKey:
              "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
            transcriptJobId: "55555555-5555-4555-8555-555555555555",
          },
        },
        step: {
          sendEvent: send,
        },
      }),
    ).resolves.toEqual({ ids: ["evt_789"] });

    expect(convertVideoObjectToAudio).toHaveBeenCalledWith({
      sourceObjectKey: "users/user_123/uploads/video.mp4",
      audioObjectKey:
        "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
    });
    expect(completeUploadedVideoConversion).toHaveBeenCalledWith({
      meetingId: "22222222-2222-4222-8222-222222222222",
      audioMediaAssetId: "44444444-4444-4444-8444-444444444444",
      audioObjectKey:
        "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
      transcriptJobId: "55555555-5555-4555-8555-555555555555",
    });
    expect(send).toHaveBeenCalledWith("queue-audio-transcription", {
      name: "meeting/transcribe.audio",
      data: {
        meetingId: "22222222-2222-4222-8222-222222222222",
        mediaAssetId: "44444444-4444-4444-8444-444444444444",
        objectKey:
          "teams/team_123/meetings/22222222-2222-4222-8222-222222222222/assets/44444444-4444-4444-8444-444444444444.mp3",
        transcriptJobId: "55555555-5555-4555-8555-555555555555",
      },
    });
  });
});
