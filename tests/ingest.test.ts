import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createElevenLabsTranscriptJob,
  normalizeElevenLabsWebhook,
} from "@/lib/vendors/elevenlabs";
import { normalizeRecallWebhook, scheduleRecallBot } from "@/lib/vendors/recall";

async function postElevenLabsWebhook(body: unknown) {
  const { POST } = await import("@/app/api/elevenlabs/webhook/route");

  return POST(
    new Request("https://app.example.com/api/elevenlabs/webhook", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
  );
}

async function postRecallWebhook(body: unknown) {
  const { POST } = await import("@/app/api/recall/webhook/route");

  return POST(
    new Request("https://app.example.com/api/recall/webhook", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
  );
}

describe("vendor webhook normalization", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("normalizes Recall bot status webhooks", () => {
    expect(
      normalizeRecallWebhook({
        event: "bot.status_change",
        data: {
          data: {
            code: "done",
            sub_code: "recording_done",
            updated_at: "2026-06-23T12:00:00Z",
          },
          bot: {
            id: "bot_123",
            metadata: {
              requested_webhook_url: "https://app.example.com/api/recall/webhook",
              meeting_id: "meeting_456",
            },
          },
        },
      }),
    ).toEqual({
      eventType: "bot.status_change",
      botId: "bot_123",
      recordingId: null,
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: "recording_done",
      updatedAt: "2026-06-23T12:00:00Z",
      metadata: {
        requested_webhook_url: "https://app.example.com/api/recall/webhook",
        meeting_id: "meeting_456",
      },
    });
  });

  it("keeps compatibility with old Recall bot completion fixtures", () => {
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
      statusCode: null,
      code: null,
      subCode: null,
      updatedAt: null,
      metadata: {},
    });
  });

  it("normalizes ElevenLabs speech to text webhooks", () => {
    expect(
      normalizeElevenLabsWebhook({
        type: "speech_to_text_transcription",
        data: {
          request_id: "req_123",
          webhook_metadata: {
            requestedWebhookUrl: "https://app.example.com/api/elevenlabs/webhook",
            meeting_id: "meeting_456",
          },
          transcription: {
            text: "Transcript text",
          },
        },
      }),
    ).toEqual({
      eventType: "speech_to_text_transcription",
      type: "speech_to_text_transcription",
      requestId: "req_123",
      transcriptId: null,
      status: "completed",
      transcriptionText: "Transcript text",
      metadata: {
        requestedWebhookUrl: "https://app.example.com/api/elevenlabs/webhook",
        meeting_id: "meeting_456",
      },
    });
  });

  it("keeps compatibility with old ElevenLabs transcript completion fixtures", () => {
    expect(
      normalizeElevenLabsWebhook({
        event: "transcript.completed",
        transcript_id: "tr_123",
        status: "completed",
      }),
    ).toEqual({
      eventType: "transcript.completed",
      type: "transcript.completed",
      requestId: null,
      transcriptId: "tr_123",
      status: "completed",
      transcriptionText: null,
      metadata: {},
    });
  });

  it("accepts real ElevenLabs webhook payloads through the route", async () => {
    const response = await postElevenLabsWebhook({
      type: "speech_to_text_transcription",
      data: {
        request_id: "req_123",
        webhook_metadata: {},
        transcription: {
          text: "Transcript text",
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      event: {
        eventType: "speech_to_text_transcription",
        requestId: "req_123",
      },
    });
  });

  it("returns 400 for invalid ElevenLabs webhook payloads", async () => {
    const response = await postElevenLabsWebhook({
      type: "speech_to_text_transcription",
      data: {},
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook payload",
    });
  });

  it("accepts real Recall webhook payloads through the route", async () => {
    const response = await postRecallWebhook({
      event: "bot.status_change",
      data: {
        data: {
          code: "done",
          sub_code: "recording_done",
          updated_at: "2026-06-23T12:00:00Z",
        },
        bot: {
          id: "bot_123",
          metadata: {},
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      event: {
        eventType: "bot.status_change",
        botId: "bot_123",
        statusCode: "done",
      },
    });
  });

  it("returns 400 for invalid Recall webhook payloads", async () => {
    const response = await postRecallWebhook({
      event: "bot.status_change",
      data: {},
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook payload",
    });
  });
});

describe("vendor job creation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends ElevenLabs webhook metadata only as request correlation data", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "elevenlabs-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "req_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createElevenLabsTranscriptJob({
      audioUrl: "https://cdn.example.com/audio.mp3",
      webhookUrl: "https://app.example.com/api/elevenlabs/webhook",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ "xi-api-key": "elevenlabs-key" });
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("webhook")).toBe("true");
    expect(JSON.parse(String(init.body.get("webhook_metadata")))).toEqual({
      requestedWebhookUrl: "https://app.example.com/api/elevenlabs/webhook",
    });
  });

  it("sends Recall webhook URL only as request correlation metadata", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "bot_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await scheduleRecallBot({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      meeting_url: "https://meet.google.com/abc-defg-hij",
      metadata: {
        requested_webhook_url: "https://app.example.com/api/recall/webhook",
      },
    });
  });
});
