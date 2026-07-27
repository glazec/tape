import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyRecallMeetingEvent,
  buildRecallMeetingUpdate,
} from "@/lib/recall-meetings";

const {
  createRecallRecordingTranscription,
  fetchAndPersistRecallParticipantTimeline,
  isRecallBotAccepted,
  isRecallDesktopSdkFallbackIntent,
  probeRecallMediaDurationMs,
  retrieveRecallBot,
  retrieveRecallRecording,
  send,
  select,
  selectFrom,
  selectLimit,
  selectWhere,
  update,
  where,
} = vi.hoisted(() => ({
  createRecallRecordingTranscription: vi.fn(),
  fetchAndPersistRecallParticipantTimeline: vi.fn(),
  isRecallBotAccepted: vi.fn(),
  isRecallDesktopSdkFallbackIntent: vi.fn(),
  probeRecallMediaDurationMs: vi.fn(),
  retrieveRecallBot: vi.fn(),
  retrieveRecallRecording: vi.fn(),
  send: vi.fn(),
  select: vi.fn(),
  selectFrom: vi.fn(),
  selectLimit: vi.fn(),
  selectWhere: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
    update,
  },
}));

vi.mock("@/inngest/client", () => ({
  inngest: {
    send,
  },
}));

vi.mock("@/lib/transcription-records", () => ({
  createRecallRecordingTranscription,
}));

vi.mock("@/lib/meeting-participant-timeline", () => ({
  fetchAndPersistRecallParticipantTimeline,
}));

vi.mock("@/lib/local-recorder-records", () => ({
  isRecallDesktopSdkFallbackIntent,
}));

vi.mock("@/lib/meeting-bot-lineage", () => ({
  isRecallBotAccepted,
}));

vi.mock("@/lib/recall-media-duration", () => ({
  probeRecallMediaDurationMs,
}));

vi.mock("@/lib/vendors/recall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendors/recall")>();

  return {
    ...actual,
    retrieveRecallBot,
    retrieveRecallRecording,
  };
});

afterEach(() => {
  createRecallRecordingTranscription.mockReset();
  fetchAndPersistRecallParticipantTimeline.mockReset();
  isRecallBotAccepted.mockReset();
  isRecallBotAccepted.mockResolvedValue(true);
  isRecallDesktopSdkFallbackIntent.mockReset();
  probeRecallMediaDurationMs.mockReset();
  probeRecallMediaDurationMs.mockImplementation(async (url: string) => {
    if (url.endsWith("/recording.mp4")) {
      return 45 * 60_000;
    }

    if (url.endsWith("/part-2.mp4")) {
      return 1_113_000;
    }

    return 10 * 60_000;
  });
  retrieveRecallBot.mockReset();
  retrieveRecallRecording.mockReset();
  send.mockReset();
  select.mockReset();
  selectFrom.mockReset();
  selectLimit.mockReset();
  selectWhere.mockReset();
  update.mockReset();
  where.mockReset();
});

describe("buildRecallMeetingUpdate", () => {
  it("marks meetings as processing when Recall reports recording done", () => {
    expect(
      buildRecallMeetingUpdate({
        eventType: "bot.status_change",
        botId: "bot_123",
        recordingId: null,
        meetingUrl: null,
        statusCode: "done",
        code: "done",
        subCode: "recording_done",
        updatedAt: "2026-06-23T12:00:00Z",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).toEqual({
      action: "update",
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "bot_123",
      recallRecordingId: null,
      status: "processing",
    });
  });

  it("marks terminal bot done without a recording as missed", () => {
    expect(
      buildRecallMeetingUpdate({
        eventType: "bot.done",
        botId: "bot_123",
        recordingId: null,
        meetingUrl: null,
        statusCode: "done",
        code: "done",
        subCode: null,
        updatedAt: "2026-06-23T12:00:00Z",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).toEqual({
      action: "update",
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "bot_123",
      recallRecordingId: null,
      status: "missed",
    });
  });

  it("marks Recall bot fatal join failures as missed", () => {
    expect(
      buildRecallMeetingUpdate({
        eventType: "bot.status_change",
        botId: "bot_123",
        recordingId: null,
        meetingUrl: null,
        statusCode: "fatal",
        code: "fatal",
        subCode: "meeting_not_found",
        updatedAt: null,
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).toEqual({
      action: "update",
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "bot_123",
      recallRecordingId: null,
      status: "missed",
    });
  });

  it("marks bot call endings without a recording as missed", () => {
    expect(
      buildRecallMeetingUpdate({
        eventType: "bot.call_ended",
        botId: "bot_123",
        recordingId: null,
        meetingUrl: null,
        statusCode: "call_ended",
        code: "call_ended",
        subCode: "timeout_exceeded_waiting_room",
        updatedAt: "2026-06-23T12:00:00Z",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).toEqual({
      action: "update",
      meetingId: "11111111-1111-4111-8111-111111111111",
      recallBotId: "bot_123",
      recallRecordingId: null,
      status: "missed",
    });
  });

  it("skips Recall events without local meeting metadata", () => {
    expect(
      buildRecallMeetingUpdate({
        eventType: "bot.status_change",
        botId: "bot_123",
        recordingId: null,
        meetingUrl: null,
        statusCode: "done",
        code: "done",
        subCode: "recording_done",
        updatedAt: null,
        metadata: {},
      }),
    ).toEqual({
      action: "skip",
      reason: "missing_meeting_id",
    });
  });
});

describe("applyRecallMeetingEvent", () => {
  it("rejects a completed recording from a displaced bot", async () => {
    isRecallBotAccepted.mockResolvedValue(false);

    await expect(
      applyRecallMeetingEvent({
        eventType: "recording.done",
        botId: "scheduled_bot",
        recordingId: "short_recording",
        meetingUrl: null,
        statusCode: "done",
        code: "done",
        subCode: null,
        updatedAt: "2026-07-22T18:04:22.306Z",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).resolves.toEqual({
      action: "skip",
      reason: "stale_bot",
    });

    expect(update).not.toHaveBeenCalled();
    expect(retrieveRecallBot).not.toHaveBeenCalled();
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not revert a locally-recovered meeting to missed on a late bot.done", async () => {
    const setSpy = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set: setSpy });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    // Meeting was already carried to "processing" by a local-recorder upload,
    // and never had a Recall recording id.
    selectLimit.mockResolvedValue([
      { recallRecordingId: null, status: "processing" },
    ]);

    await applyRecallMeetingEvent({
      eventType: "bot.done",
      botId: "bot_123",
      recordingId: null,
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: null,
      updatedAt: "2026-07-10T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });

  it("ignores failed SDK uploads after the app switched to local capture", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    isRecallDesktopSdkFallbackIntent.mockResolvedValue(true);

    await expect(
      applyRecallMeetingEvent({
        eventType: "sdk_upload.failed",
        botId: null,
        recordingId: "failed_recording_123",
        meetingUrl: null,
        statusCode: "failed",
        code: "failed",
        subCode: null,
        updatedAt: "2026-07-10T12:00:00Z",
        metadata: {
          fallbackIntentId: "intent_123",
          meetingId: "11111111-1111-4111-8111-111111111111",
          source: "local_recorder_sdk",
        },
      }),
    ).resolves.toEqual({
      action: "skip",
      reason: "local_fallback_active",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores completed SDK artifacts after the app switched to local capture", async () => {
    isRecallDesktopSdkFallbackIntent.mockResolvedValue(true);

    await expect(
      applyRecallMeetingEvent({
        eventType: "sdk_upload.complete",
        botId: null,
        recordingId: "partial_recording_123",
        meetingUrl: null,
        statusCode: "complete",
        code: "complete",
        subCode: null,
        updatedAt: "2026-07-10T12:00:00Z",
        metadata: {
          fallbackIntentId: "intent_123",
          meetingId: "11111111-1111-4111-8111-111111111111",
          source: "local_recorder_sdk",
        },
      }),
    ).resolves.toEqual({
      action: "skip",
      reason: "local_fallback_active",
    });
    expect(update).not.toHaveBeenCalled();
    expect(retrieveRecallRecording).not.toHaveBeenCalled();
  });

  it("queues transcription when Recall reports a completed recording", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);
    retrieveRecallBot.mockResolvedValue({
      status_changes: [
        {
          code: "in_call_recording",
          created_at: "2026-06-23T12:00:00.000Z",
        },
        {
          code: "call_ended",
          created_at: "2026-06-23T12:45:00.000Z",
        },
      ],
      recordings: [
        {
          completed_at: "2026-06-23T12:45:00.000Z",
          id: "recording_123",
          started_at: "2026-06-23T12:00:00.000Z",
          media_shortcuts: {
            speaker_timeline: {
              data: {
                download_url:
                  "https://recall.example.com/speaker-timeline.json",
              },
            },
            video_mixed: {
              data: {
                download_url: "https://recall.example.com/recording.mp4",
              },
            },
          },
        },
      ],
    });
    createRecallRecordingTranscription.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });

    await applyRecallMeetingEvent({
      eventType: "bot.status_change",
      botId: "bot_123",
      recordingId: "recording_123",
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: "recording_done",
      updatedAt: "2026-06-23T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(createRecallRecordingTranscription).toHaveBeenCalledWith({
      durationMs: 45 * 60 * 1000,
      endedAt: new Date("2026-06-23T12:45:00.000Z"),
      externalBotId: "bot_123",
      externalRecordingId: "recording_123",
      meetingId: "11111111-1111-4111-8111-111111111111",
      mode: "replace",
      startedAt: new Date("2026-06-23T12:00:00.000Z"),
    });
    expect(fetchAndPersistRecallParticipantTimeline).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      timelineUrl: "https://recall.example.com/speaker-timeline.json",
    });
    expect(send.mock.calls).toEqual([
      [
        {
          id: "video-frames:recording_123:recording",
          name: "meeting/extract.video-frames",
          data: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            recallBotId: "bot_123",
            recallRecordingId: "recording_123",
          },
        },
      ],
      [
        {
          name: "meeting/transcribe.audio",
          data: {
            audioUrl: "https://recall.example.com/recording.mp4",
            meetingId: "11111111-1111-4111-8111-111111111111",
            transcriptJobId: "22222222-2222-4222-8222-222222222222",
          },
        },
      ],
    ]);
  });

  it("retries before creating a transcript job when canonical media is clipped", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    retrieveRecallBot.mockResolvedValue({
      status_changes: [
        {
          code: "in_call_recording",
          created_at: "2026-07-22T17:21:27.499Z",
        },
        {
          code: "call_ended",
          created_at: "2026-07-22T18:04:18.857Z",
        },
      ],
      recordings: [
        {
          completed_at: "2026-07-22T18:04:22.306Z",
          id: "recording_123",
          started_at: "2026-07-22T17:45:06.712Z",
          media_shortcuts: {
            video_mixed: {
              data: {
                download_url: "https://recall.example.com/short.mp4",
              },
            },
          },
        },
      ],
    });

    await expect(
      applyRecallMeetingEvent({
        eventType: "recording.done",
        botId: "bot_123",
        recordingId: "recording_123",
        meetingUrl: null,
        statusCode: "done",
        code: "done",
        subCode: null,
        updatedAt: "2026-07-22T18:04:22.306Z",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).rejects.toThrow("Recall recording is not ready: timing_mismatch");

    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("retries before transcription when the physical media is clipped", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    probeRecallMediaDurationMs.mockResolvedValue(19 * 60_000);
    retrieveRecallBot.mockResolvedValue({
      status_changes: [
        {
          code: "in_call_recording",
          created_at: "2026-07-22T17:21:27.499Z",
        },
        {
          code: "call_ended",
          created_at: "2026-07-22T18:04:18.857Z",
        },
      ],
      recordings: [
        {
          completed_at: "2026-07-22T18:04:24.599Z",
          id: "recording_123",
          started_at: "2026-07-22T17:21:27.499Z",
          media_shortcuts: {
            video_mixed: {
              data: {
                download_url: "https://recall.example.com/clipped.mp4",
              },
            },
          },
        },
      ],
    });

    await expect(
      applyRecallMeetingEvent({
        eventType: "recording.done",
        botId: "bot_123",
        recordingId: "recording_123",
        meetingUrl: null,
        statusCode: "done",
        code: "done",
        subCode: null,
        updatedAt: "2026-07-22T18:04:24.599Z",
        metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
        },
      }),
    ).rejects.toThrow("Recall recording is not ready: media_timing_mismatch");
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("queues a resumed recording as another transcript part", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);
    retrieveRecallBot.mockResolvedValue({
      status_changes: [
        {
          code: "in_call_recording",
          created_at: "2026-07-22T17:21:27.000Z",
        },
        {
          code: "call_ended",
          created_at: "2026-07-22T17:40:00.000Z",
        },
      ],
      recordings: [
        {
          completed_at: "2026-07-22T17:40:00.000Z",
          id: "recording_456",
          started_at: "2026-07-22T17:21:27.000Z",
          media_shortcuts: {
            audio_mixed: {
              data: { download_url: "https://recall.example.com/part-2.mp3" },
            },
            video_mixed: {
              data: { download_url: "https://recall.example.com/part-2.mp4" },
            },
          },
        },
      ],
    });
    createRecallRecordingTranscription.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptJobId: "33333333-3333-4333-8333-333333333333",
    });

    await applyRecallMeetingEvent({
      eventType: "recording.done",
      botId: "bot_456",
      recordingId: "recording_456",
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: null,
      updatedAt: "2026-07-22T17:40:00.000Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        resumeRecording: true,
      },
    });

    expect(createRecallRecordingTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        externalBotId: "bot_456",
        externalRecordingId: "recording_456",
        mode: "append",
      }),
    );
    expect(send).toHaveBeenCalledWith({
      name: "meeting/transcribe.audio",
      data: expect.objectContaining({
        audioUrl: "https://recall.example.com/part-2.mp3",
        transcriptJobId: "33333333-3333-4333-8333-333333333333",
      }),
    });
  });

  it("queues extraction but not duplicate transcription for the same recording", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
      },
    ]);
    retrieveRecallBot.mockResolvedValue({
      id: "bot_123",
      status_changes: [
        {
          code: "in_call_recording",
          created_at: "2026-06-23T12:00:00.000Z",
        },
        {
          code: "call_ended",
          created_at: "2026-06-23T12:10:00.000Z",
        },
      ],
      recordings: [
        {
          completed_at: "2026-06-23T12:10:00.000Z",
          id: "recording_123",
          started_at: "2026-06-23T12:00:00.000Z",
          media_shortcuts: {
            audio_mixed: {
              data: { download_url: "https://recall.example.com/audio.mp3" },
            },
            video_mixed: {
              data: { download_url: "https://recall.example.com/video.mp4" },
            },
          },
        },
      ],
    });
    createRecallRecordingTranscription.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      recordingId: "44444444-4444-4444-8444-444444444444",
      shouldQueue: false,
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });

    await applyRecallMeetingEvent({
      eventType: "recording.done",
      botId: "bot_123",
      recordingId: "recording_123",
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: null,
      updatedAt: "2026-06-23T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(createRecallRecordingTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ externalRecordingId: "recording_123" }),
    );
    expect(send).toHaveBeenCalledExactlyOnceWith({
      id: "video-frames:recording_123:recording",
      name: "meeting/extract.video-frames",
      data: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        recallBotId: "bot_123",
        recallRecordingId: "recording_123",
      },
    });
  });

  it("does not queue another transcription without an extraction recording ID", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
      },
    ]);

    await applyRecallMeetingEvent({
      eventType: "bot.status_change",
      botId: "bot_123",
      recordingId: null,
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: "recording_done",
      updatedAt: "2026-06-23T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(retrieveRecallBot).not.toHaveBeenCalled();
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("queues transcription when a Recall Desktop SDK upload completes", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);
    retrieveRecallRecording.mockResolvedValue({
      id: "recording_123",
      started_at: "2026-07-08T11:00:00.000Z",
      media_shortcuts: {
        audio_mixed: {
          data: {
            download_url: "https://recall.example.com/sdk-audio.mp3",
          },
        },
        participant_events: {
          data: {
            participant_events_download_url:
              "https://recall.example.com/sdk-participant-events.json",
            speaker_timeline_download_url:
              "https://recall.example.com/sdk-speaker-timeline.json",
          },
        },
        video_mixed: {
          data: {
            download_url: "https://recall.example.com/sdk-video.mp4",
          },
        },
      },
    });
    createRecallRecordingTranscription.mockResolvedValue({
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptJobId: "22222222-2222-4222-8222-222222222222",
    });

    await applyRecallMeetingEvent({
      eventType: "sdk_upload.complete",
      botId: null,
      recordingId: "recording_123",
      meetingUrl: null,
      statusCode: "complete",
      code: "complete",
      subCode: null,
      updatedAt: "2026-07-08T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        source: "local_recorder_sdk",
      },
    });

    expect(retrieveRecallBot).not.toHaveBeenCalled();
    expect(retrieveRecallRecording).toHaveBeenCalledWith("recording_123");
    expect(createRecallRecordingTranscription).toHaveBeenCalledWith({
      externalBotId: undefined,
      externalRecordingId: "recording_123",
      meetingId: "11111111-1111-4111-8111-111111111111",
      mode: "replace",
    });
    expect(fetchAndPersistRecallParticipantTimeline).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      timelineUrl: "https://recall.example.com/sdk-speaker-timeline.json",
    });
    expect(send.mock.calls).toEqual([
      [
        {
          id: "video-frames:recording_123:recording",
          name: "meeting/extract.video-frames",
          data: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            recallRecordingId: "recording_123",
          },
        },
      ],
      [
        {
          name: "meeting/transcribe.audio",
          data: {
            audioUrl: "https://recall.example.com/sdk-audio.mp3",
            meetingId: "11111111-1111-4111-8111-111111111111",
            transcriptJobId: "22222222-2222-4222-8222-222222222222",
          },
        },
      ],
    ]);
  });

  it("fails a completed SDK upload when Recall has terminal failed media", async () => {
    const initialSet = vi.fn().mockReturnValue({ where });
    const failureSet = vi.fn().mockReturnValue({ where });
    update
      .mockReturnValueOnce({ set: initialSet })
      .mockReturnValueOnce({ set: failureSet });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);
    retrieveRecallRecording.mockResolvedValue({
      id: "recording_123",
      status: { code: "done" },
      media_shortcuts: {
        audio_mixed: null,
        video_mixed: {
          status: { code: "failed" },
          data: { download_url: null },
        },
      },
    });

    await applyRecallMeetingEvent({
      eventType: "sdk_upload.complete",
      botId: null,
      recordingId: "recording_123",
      meetingUrl: null,
      statusCode: "complete",
      code: "complete",
      subCode: null,
      updatedAt: "2026-07-08T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        source: "local_recorder_sdk",
      },
    });

    expect(failureSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not guess which bot recording failed when the webhook omits its id", async () => {
    const setSpy = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set: setSpy });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);
    retrieveRecallBot.mockResolvedValue({
      id: "bot_123",
      recordings: [
        {
          id: "recording_123",
          status: { code: "done" },
          media_shortcuts: {
            audio_mixed: null,
            video_mixed: {
              status: { code: "failed" },
              data: { download_url: null },
            },
          },
        },
      ],
    });

    await applyRecallMeetingEvent({
      eventType: "bot.status_change",
      botId: "bot_123",
      recordingId: null,
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: "recording_done",
      updatedAt: "2026-07-08T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "processing" }),
    );
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("retries SDK completion when the final speaker timeline cannot be persisted", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);
    retrieveRecallRecording.mockResolvedValue({
      id: "recording_123",
      media_shortcuts: {
        audio_mixed: {
          data: { download_url: "https://recall.example.com/sdk-audio.mp3" },
        },
        participant_events: {
          data: {
            speaker_timeline_download_url:
              "https://recall.example.com/sdk-speaker-timeline.json",
          },
        },
      },
    });
    fetchAndPersistRecallParticipantTimeline.mockRejectedValue(
      new Error("temporary Recall download failure"),
    );

    await expect(
      applyRecallMeetingEvent({
        eventType: "sdk_upload.complete",
        botId: null,
        recordingId: "recording_123",
        meetingUrl: null,
        statusCode: "complete",
        code: "complete",
        subCode: null,
        updatedAt: "2026-07-10T12:00:00Z",
        metadata: {
          fallbackIntentId: "intent_123",
          meetingId: "11111111-1111-4111-8111-111111111111",
          source: "local_recorder_sdk",
        },
      }),
    ).rejects.toThrow("temporary Recall download failure");
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      id: "video-frames:recording_123:recording",
      name: "meeting/extract.video-frames",
      data: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        recallRecordingId: "recording_123",
      },
    });
  });

  it("queues extraction but not transcription for video completion assets", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);
    retrieveRecallBot.mockResolvedValue({
      status_changes: [
        {
          code: "in_call_recording",
          created_at: "2026-06-23T12:00:00.000Z",
        },
        {
          code: "call_ended",
          created_at: "2026-06-23T12:45:00.000Z",
        },
      ],
      recordings: [
        {
          completed_at: "2026-06-23T12:45:05.000Z",
          id: "recording_123",
          started_at: "2026-06-23T12:00:00.000Z",
          media_shortcuts: {
            video_mixed: {
              data: {
                download_url: "https://recall.example.com/recording.mp4",
              },
            },
          },
        },
      ],
    });

    await applyRecallMeetingEvent({
      eventType: "video_mixed.done",
      botId: "bot_123",
      recordingId: "recording_123",
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: null,
      updatedAt: "2026-06-23T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      id: "video-frames:recording_123:video-mixed",
      name: "meeting/extract.video-frames",
      data: {
        meetingId: "11111111-1111-4111-8111-111111111111",
        recallBotId: "bot_123",
        recallRecordingId: "recording_123",
      },
    });
  });

  it("does not downgrade a recorded meeting to missed from a late call ended event", async () => {
    const updateSet = vi.fn().mockReturnValue({ where });
    update.mockReturnValue({ set: updateSet });
    select
      .mockReturnValueOnce({ from: selectFrom })
      .mockReturnValueOnce({ from: selectFrom });
    selectFrom
      .mockReturnValueOnce({ where: selectWhere })
      .mockReturnValueOnce({ where: selectWhere });
    selectWhere
      .mockReturnValueOnce({ limit: selectLimit })
      .mockReturnValueOnce({ limit: selectLimit });
    selectLimit
      .mockResolvedValueOnce([
        {
          recallRecordingId: "recording_123",
        },
      ])
      .mockResolvedValueOnce([]);

    await applyRecallMeetingEvent({
      eventType: "bot.call_ended",
      botId: "bot_123",
      recordingId: null,
      meetingUrl: null,
      statusCode: "call_ended",
      code: "call_ended",
      subCode: "call_ended_by_host",
      updatedAt: "2026-06-23T12:00:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: undefined,
      }),
    );
  });
});
