import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyRecallMeetingEvent,
  buildRecallMeetingUpdate,
} from "@/lib/recall-meetings";

const {
  createRecallRecordingTranscription,
  fetchAndPersistRecallParticipantTimeline,
  isRecallDesktopSdkFallbackIntent,
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
  isRecallDesktopSdkFallbackIntent: vi.fn(),
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
  isRecallDesktopSdkFallbackIntent.mockReset();
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
      recordings: [
        {
          id: "recording_123",
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
      meetingId: "11111111-1111-4111-8111-111111111111",
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

  it("queues extraction when a transcript job already exists", async () => {
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

    expect(retrieveRecallBot).not.toHaveBeenCalled();
    expect(createRecallRecordingTranscription).not.toHaveBeenCalled();
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
      media_shortcuts: {
        audio_mixed: {
          data: {
            download_url: "https://recall.example.com/sdk-audio.mp3",
          },
        },
        participant_events: {
          data: {
            speaker_timeline_download_url:
              "https://recall.example.com/sdk-speaker-timeline.json",
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
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(fetchAndPersistRecallParticipantTimeline).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      timelineUrl: "https://recall.example.com/sdk-speaker-timeline.json",
    });
    expect(send).toHaveBeenCalledWith({
      name: "meeting/transcribe.audio",
      data: {
        audioUrl: "https://recall.example.com/sdk-audio.mp3",
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      },
    });
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
    expect(send).not.toHaveBeenCalled();
  });

  it("queues extraction but not transcription for video completion assets", async () => {
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    });
    select.mockReturnValue({ from: selectFrom });
    selectFrom.mockReturnValue({ where: selectWhere });
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectLimit.mockResolvedValue([]);

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

    expect(retrieveRecallBot).not.toHaveBeenCalled();
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
