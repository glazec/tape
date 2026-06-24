import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyRecallMeetingEvent,
  buildRecallMeetingUpdate,
} from "@/lib/recall-meetings";

const {
  createRecallRecordingTranscription,
  retrieveRecallBot,
  send,
  update,
  where,
} = vi.hoisted(() => ({
  createRecallRecordingTranscription: vi.fn(),
  retrieveRecallBot: vi.fn(),
  send: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
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

vi.mock("@/lib/vendors/recall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vendors/recall")>();

  return {
    ...actual,
    retrieveRecallBot,
  };
});

afterEach(() => {
  createRecallRecordingTranscription.mockReset();
  retrieveRecallBot.mockReset();
  send.mockReset();
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

  it("marks meetings as failed when Recall reports an error", () => {
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
      status: "failed",
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
    retrieveRecallBot.mockResolvedValue({
      recordings: [
        {
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
    expect(send).toHaveBeenCalledWith({
      name: "meeting/transcribe.audio",
      data: {
        audioUrl: "https://recall.example.com/recording.mp4",
        meetingId: "11111111-1111-4111-8111-111111111111",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      },
    });
  });
});
