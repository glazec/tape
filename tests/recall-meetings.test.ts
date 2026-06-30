import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyRecallMeetingEvent,
  buildRecallMeetingUpdate,
} from "@/lib/recall-meetings";

const {
  createRecallRecordingTranscription,
  fetchAndPersistRecallParticipantTimeline,
  persistRecallBotScreenshots,
  retrieveRecallBot,
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
  persistRecallBotScreenshots: vi.fn(),
  retrieveRecallBot: vi.fn(),
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

vi.mock("@/lib/meeting-screenshots", () => ({
  persistRecallBotScreenshots,
}));

vi.mock("@/lib/vendors/recall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendors/recall")>();

  return {
    ...actual,
    retrieveRecallBot,
  };
});

afterEach(() => {
  createRecallRecordingTranscription.mockReset();
  fetchAndPersistRecallParticipantTimeline.mockReset();
  persistRecallBotScreenshots.mockReset();
  retrieveRecallBot.mockReset();
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

  it("leaves terminal bot done without a recording status unchanged", () => {
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
      status: null,
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

    expect(retrieveRecallBot).toHaveBeenCalledWith("bot_123");
    expect(createRecallRecordingTranscription).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(fetchAndPersistRecallParticipantTimeline).toHaveBeenCalledWith({
      meetingId: "11111111-1111-4111-8111-111111111111",
      timelineUrl: "https://recall.example.com/speaker-timeline.json",
    });
    expect(persistRecallBotScreenshots).toHaveBeenCalledWith({
      botId: "bot_123",
      meetingId: "11111111-1111-4111-8111-111111111111",
    });
    expect(send).toHaveBeenCalledWith({
      name: "meeting/transcribe.audio",
      data: {
        audioUrl: "https://recall.example.com/recording.mp4",
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      },
    });
  });

  it("does not queue another transcription when a transcript job already exists", async () => {
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
