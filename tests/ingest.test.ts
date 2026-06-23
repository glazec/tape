import { describe, expect, it } from "vitest";

import { normalizeElevenLabsWebhook } from "@/lib/vendors/elevenlabs";
import { normalizeRecallWebhook } from "@/lib/vendors/recall";

describe("vendor webhook normalization", () => {
  it("normalizes Recall bot completion webhooks", () => {
    expect(
      normalizeRecallWebhook({
        event: "bot.done",
        data: {
          bot_id: "bot_123",
          recording_id: "rec_456",
          meeting_url: "https://meet.google.com/abc-defg-hij",
        },
      }),
    ).toEqual({
      eventType: "bot.done",
      botId: "bot_123",
      recordingId: "rec_456",
      meetingUrl: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("normalizes ElevenLabs transcript completion webhooks", () => {
    expect(
      normalizeElevenLabsWebhook({
        event: "transcript.completed",
        transcript_id: "tr_123",
        status: "completed",
      }),
    ).toEqual({
      eventType: "transcript.completed",
      transcriptId: "tr_123",
      status: "completed",
    });
  });
});
