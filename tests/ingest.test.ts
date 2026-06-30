import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createElevenLabsTranscriptJob,
  normalizeElevenLabsWebhook,
} from "@/lib/vendors/elevenlabs";
import {
  deleteScheduledRecallBot,
  extractRecallBotScreenshots,
  findRecallRecordingMediaUrl,
  findRecallSpeakerTimelineUrl,
  listRecallBotScreenshots,
  sendRecallChatMessage,
  normalizeRecallWebhook,
  retrieveRecallBot,
  scheduleRecallBot,
  updateScheduledRecallBot,
} from "@/lib/vendors/recall";
import { generateOpenRouterChatReply } from "@/lib/vendors/openrouter";

const {
  applyElevenLabsTranscriptEvent,
  applyRecallMeetingEvent,
  markVendorWebhookEventProcessed,
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationQueued,
  recordVendorWebhookEvent,
  MissingWebhookIdempotencyKeyError,
} = vi.hoisted(() => ({
    applyElevenLabsTranscriptEvent: vi.fn(),
    applyRecallMeetingEvent: vi.fn(),
    markVendorWebhookEventProcessed: vi.fn(),
    markMeetingTranslationCompleted: vi.fn(),
    markMeetingTranslationFailed: vi.fn(),
    markMeetingTranslationQueued: vi.fn(),
    recordVendorWebhookEvent: vi.fn(),
    MissingWebhookIdempotencyKeyError: class MissingWebhookIdempotencyKeyError extends Error {
      constructor() {
        super("Missing webhook idempotency key");
      }
    },
  }));

vi.mock("@/lib/vendor-webhook-events", () => {
  return {
    MissingWebhookIdempotencyKeyError,
    markVendorWebhookEventProcessed,
    recordVendorWebhookEvent,
  };
});

vi.mock("@/lib/elevenlabs-transcripts", () => ({
  applyElevenLabsTranscriptEvent,
}));

vi.mock("@/lib/meeting-translation-jobs", () => ({
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationQueued,
}));

vi.mock("@/lib/recall-meetings", () => ({
  applyRecallMeetingEvent,
}));

const elevenLabsWebhookSecret = "elevenlabs-webhook-secret";
const recallWebhookSecret = "whsec_cmVjYWxsLXdlYmhvb2stc2VjcmV0";

function signElevenLabsWebhook(rawBody: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", elevenLabsWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  return `t=${timestamp},v0=${signature}`;
}

function signRecallWebhook(rawBody: string) {
  const messageId = "msg_test";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return signRecallWebhookWithTimestamp(rawBody, messageId, timestamp);
}

function signRecallWebhookWithTimestamp(
  rawBody: string,
  messageId: string,
  timestamp: string,
) {
  const key = Buffer.from(recallWebhookSecret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${messageId}.${timestamp}.${rawBody}`)
    .digest("base64");

  return {
    "webhook-id": messageId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
}

async function postElevenLabsWebhook(
  body: unknown,
  signed = true,
  envSecret = elevenLabsWebhookSecret,
) {
  vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", envSecret);
  const { POST } = await import("@/app/api/elevenlabs/webhook/route");
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (signed) {
    headers["elevenlabs-signature"] = signElevenLabsWebhook(rawBody);
  }

  return POST(
    new Request("https://app.example.com/api/elevenlabs/webhook", {
      method: "POST",
      body: rawBody,
      headers,
    }),
  );
}

async function postRecallWebhook(
  body: unknown,
  signed = true,
  envSecret = recallWebhookSecret,
) {
  vi.stubEnv("RECALL_WEBHOOK_SECRET", envSecret);
  const { POST } = await import("@/app/api/recall/webhook/route");
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (signed) {
    Object.assign(headers, signRecallWebhook(rawBody));
  }

  return POST(
    new Request("https://app.example.com/api/recall/webhook", {
      method: "POST",
      body: rawBody,
      headers,
    }),
  );
}

async function postElevenLabsWebhookWithHeaders(
  body: unknown,
  headers: Record<string, string>,
) {
  vi.stubEnv("ELEVENLABS_WEBHOOK_SECRET", elevenLabsWebhookSecret);
  const { POST } = await import("@/app/api/elevenlabs/webhook/route");
  const rawBody = JSON.stringify(body);

  return POST(
    new Request("https://app.example.com/api/elevenlabs/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    }),
  );
}

async function postRecallWebhookWithHeaders(
  body: unknown,
  headers: Record<string, string>,
) {
  vi.stubEnv("RECALL_WEBHOOK_SECRET", recallWebhookSecret);
  const { POST } = await import("@/app/api/recall/webhook/route");
  const rawBody = JSON.stringify(body);

  return POST(
    new Request("https://app.example.com/api/recall/webhook", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        ...headers,
      },
    }),
  );
}

describe("vendor webhook normalization", () => {
  beforeEach(() => {
    recordVendorWebhookEvent.mockResolvedValue({
      inserted: true,
      shouldProcess: true,
    });
    markVendorWebhookEventProcessed.mockResolvedValue(undefined);
    markMeetingTranslationCompleted.mockResolvedValue(undefined);
    markMeetingTranslationFailed.mockResolvedValue(undefined);
    markMeetingTranslationQueued.mockResolvedValue(undefined);
    applyElevenLabsTranscriptEvent.mockResolvedValue({ action: "skip" });
    applyRecallMeetingEvent.mockResolvedValue({ action: "skip" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    markVendorWebhookEventProcessed.mockReset();
    markMeetingTranslationCompleted.mockReset();
    markMeetingTranslationFailed.mockReset();
    markMeetingTranslationQueued.mockReset();
    recordVendorWebhookEvent.mockReset();
    applyElevenLabsTranscriptEvent.mockReset();
    applyRecallMeetingEvent.mockReset();
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
              requested_webhook_url:
                "https://app.example.com/api/recall/webhook",
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

  it("normalizes Recall recording artifact webhooks", () => {
    expect(
      normalizeRecallWebhook({
        event: "recording.done",
        data: {
          data: {
            code: "done",
            sub_code: null,
            updated_at: "2026-06-23T12:05:00Z",
          },
          recording: {
            id: "rec_123",
            metadata: {},
          },
          bot: {
            id: "bot_123",
            metadata: {
              meetingId: "11111111-1111-4111-8111-111111111111",
            },
          },
        },
      }),
    ).toEqual({
      eventType: "recording.done",
      botId: "bot_123",
      recordingId: "rec_123",
      meetingUrl: null,
      statusCode: "done",
      code: "done",
      subCode: null,
      updatedAt: "2026-06-23T12:05:00Z",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
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
            requestedWebhookUrl:
              "https://app.example.com/api/elevenlabs/webhook",
            meeting_id: "meeting_456",
          },
          transcription: {
            text: "Transcript text",
            entities: [
              {
                text: "Nascent.xyz",
                type: "organization",
                start: 0,
                end: 0.5,
              },
            ],
            words: [
              {
                text: "Transcript",
                type: "word",
                start: 0,
                end: 0.5,
                speaker_id: "speaker_0",
              },
            ],
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
      transcriptionEntities: [
        {
          source: "elevenlabs",
          type: "organization",
          value: "Nascent.xyz",
          start: 0,
          end: 0.5,
        },
      ],
      transcriptionWords: [
        {
          text: "Transcript",
          type: "word",
          start: 0,
          end: 0.5,
          speakerId: "speaker_0",
        },
      ],
      metadata: {
        requestedWebhookUrl: "https://app.example.com/api/elevenlabs/webhook",
        meeting_id: "meeting_456",
      },
    });
  });

  it("normalizes ElevenLabs all entity detection fields", () => {
    expect(
      normalizeElevenLabsWebhook({
        type: "speech_to_text_transcription",
        data: {
          request_id: "req_123",
          webhook_metadata: {
            meeting_id: "meeting_456",
          },
          transcription: {
            text: "Darko mentioned 20 million.",
            entities: [
              {
                text: "Darko",
                entity_type: "name",
                start_char: 0,
                end_char: 5,
              },
              {
                text: "20 million",
                entity_type: "money",
                start_char: 16,
                end_char: 26,
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      transcriptionEntities: [
        {
          source: "elevenlabs",
          type: "name",
          value: "Darko",
          start: 0,
          end: 5,
        },
        {
          source: "elevenlabs",
          type: "money",
          value: "20 million",
          start: 16,
          end: 26,
        },
      ],
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
    const payload = {
      type: "speech_to_text_transcription",
      data: {
        request_id: "req_123",
        webhook_metadata: {},
        transcription: {
          text: "Transcript text",
        },
      },
    };
    const response = await postElevenLabsWebhook(payload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      event: {
        eventType: "speech_to_text_transcription",
        requestId: "req_123",
      },
    });
    expect(recordVendorWebhookEvent).toHaveBeenCalledWith({
      provider: "elevenlabs",
      eventType: "speech_to_text_transcription",
      idempotencyKey: "req_123",
      payload,
    });
    expect(applyElevenLabsTranscriptEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "speech_to_text_transcription",
        requestId: "req_123",
        transcriptionText: "Transcript text",
      }),
    );
  });

  it("does not queue automatic translation for mostly Chinese transcripts", async () => {
    applyElevenLabsTranscriptEvent.mockResolvedValueOnce({
      action: "complete",
      meetingId: "11111111-1111-4111-8111-111111111111",
      text: "今天我们先聊 IOSG portfolio，然后看 OpenAI API 成本和下周安排。",
    });

    const response = await postElevenLabsWebhook({
      type: "speech_to_text_transcription",
      data: {
        request_id: "req_123",
        webhook_metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
        transcription: {
          text: "今天我们先聊 IOSG portfolio，然后看 OpenAI API 成本和下周安排。",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(markMeetingTranslationCompleted).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(markMeetingTranslationQueued).not.toHaveBeenCalled();
    expect(markMeetingTranslationFailed).not.toHaveBeenCalled();
  });

  it("accepts copied ElevenLabs webhook secret values", async () => {
    const response = await postElevenLabsWebhook(
      {
        type: "speech_to_text_transcription",
        data: {
          request_id: "req_123",
          webhook_metadata: {},
          transcription: {
            text: "Transcript text",
          },
        },
      },
      true,
      `${elevenLabsWebhookSecret}\n`,
    );

    expect(response.status).toBe(200);
  });

  it("skips ElevenLabs transcript persistence for duplicate webhooks", async () => {
    recordVendorWebhookEvent.mockResolvedValueOnce({
      inserted: false,
      shouldProcess: false,
    });

    const response = await postElevenLabsWebhook({
      type: "speech_to_text_transcription",
      data: {
        request_id: "req_123",
        webhook_metadata: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          transcriptJobId: "22222222-2222-4222-8222-222222222222",
        },
        transcription: {
          text: "Transcript text",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(applyElevenLabsTranscriptEvent).not.toHaveBeenCalled();
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
    expect(recordVendorWebhookEvent).not.toHaveBeenCalled();
    expect(applyElevenLabsTranscriptEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when ElevenLabs webhook persistence fails", async () => {
    recordVendorWebhookEvent.mockRejectedValueOnce(new Error("db down"));

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

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook processing failed",
    });
    expect(applyElevenLabsTranscriptEvent).not.toHaveBeenCalled();
  });

  it("rejects unsigned ElevenLabs webhook requests", async () => {
    const response = await postElevenLabsWebhook(
      {
        type: "speech_to_text_transcription",
        data: {
          request_id: "req_123",
          webhook_metadata: {},
          transcription: {
            text: "Transcript text",
          },
        },
      },
      false,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook signature",
    });
  });

  it("rejects invalid ElevenLabs webhook signatures", async () => {
    const response = await postElevenLabsWebhookWithHeaders(
      {
        type: "speech_to_text_transcription",
        data: {
          request_id: "req_123",
          webhook_metadata: {},
          transcription: {
            text: "Transcript text",
          },
        },
      },
      {
        "elevenlabs-signature": "t=1731705121,v0=invalid",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook signature",
    });
  });

  it("accepts real Recall webhook payloads through the route", async () => {
    const payload = {
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
    };
    const response = await postRecallWebhook(payload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      event: {
        eventType: "bot.status_change",
        botId: "bot_123",
        statusCode: "done",
      },
    });
    expect(recordVendorWebhookEvent).toHaveBeenCalledWith({
      provider: "recall",
      eventType: "bot.status_change",
      idempotencyKey: "msg_test",
      payload,
    });
    expect(applyRecallMeetingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "bot.status_change",
        botId: "bot_123",
        statusCode: "done",
      }),
    );
  });

  it("accepts copied Recall webhook secret values", async () => {
    const response = await postRecallWebhook(
      {
        event: "bot.status_change",
        data: {
          data: {
            code: "done",
          },
          bot: {
            id: "bot_123",
            metadata: {},
          },
        },
      },
      true,
      `${recallWebhookSecret}\n`,
    );

    expect(response.status).toBe(200);
  });

  it("skips Recall meeting updates for duplicate webhooks", async () => {
    recordVendorWebhookEvent.mockResolvedValueOnce({
      inserted: false,
      shouldProcess: false,
    });

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
          metadata: {
            meetingId: "11111111-1111-4111-8111-111111111111",
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(applyRecallMeetingEvent).not.toHaveBeenCalled();
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
    expect(recordVendorWebhookEvent).not.toHaveBeenCalled();
    expect(applyRecallMeetingEvent).not.toHaveBeenCalled();
  });

  it("returns 500 when Recall webhook persistence fails", async () => {
    recordVendorWebhookEvent.mockRejectedValueOnce(new Error("db down"));

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

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Webhook processing failed",
    });
    expect(applyRecallMeetingEvent).not.toHaveBeenCalled();
  });

  it("rejects unsigned Recall webhook requests", async () => {
    const response = await postRecallWebhook(
      {
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
      },
      false,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook signature",
    });
  });

  it("rejects stale Recall webhook signatures", async () => {
    const payload = {
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
    };
    const rawBody = JSON.stringify(payload);
    const response = await postRecallWebhookWithHeaders(
      payload,
      signRecallWebhookWithTimestamp(rawBody, "msg_test", "1731705121"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook signature",
    });
    expect(recordVendorWebhookEvent).not.toHaveBeenCalled();
    expect(applyRecallMeetingEvent).not.toHaveBeenCalled();
  });

  it("rejects invalid Recall webhook signatures", async () => {
    const response = await postRecallWebhookWithHeaders(
      {
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
      },
      {
        "webhook-id": "msg_test",
        "webhook-timestamp": "1731705121",
        "webhook-signature": "v1,invalid",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid webhook signature",
    });
  });
});

describe("vendor job creation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends ElevenLabs webhook metadata only as request correlation data", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "elevenlabs-key\n");
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
    expect(init.body.get("diarize")).toBe("true");
    expect(init.body.get("timestamps_granularity")).toBe("word");
    expect(JSON.parse(String(init.body.get("webhook_metadata")))).toEqual({
      requestedWebhookUrl: "https://app.example.com/api/elevenlabs/webhook",
    });
  });

  it("sends Recall webhook URL only as request correlation metadata", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
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
    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({
      meeting_url: "https://meet.google.com/abc-defg-hij",
      bot_name: "IOSG Old Friend",
      metadata: {
        requested_webhook_url: "https://app.example.com/api/recall/webhook",
      },
    });
    expect(body.automatic_video_output).toEqual({
      in_call_not_recording: {
        kind: "jpeg",
        b64_data: expect.any(String),
      },
      in_call_recording: {
        kind: "jpeg",
        b64_data: expect.any(String),
      },
    });
    expect(body.automatic_video_output.in_call_recording.b64_data.length).toBeGreaterThan(
      1000,
    );
    expect(body.automatic_video_output.in_call_recording.b64_data).toBe(
      body.automatic_video_output.in_call_not_recording.b64_data,
    );
    expect(body.recording_config).toEqual({
      realtime_endpoints: [
        {
          type: "webhook",
          url: "https://app.example.com/api/recall/realtime/webhook",
          events: [
            "participant_events.chat_message",
            "participant_events.speech_on",
            "participant_events.speech_off",
          ],
        },
      ],
    });
  });

  it("uses a custom Recall bot avatar when provided", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "bot_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await scheduleRecallBot({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
      webhookUrl: "https://app.example.com/api/recall/webhook",
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));

    expect(body).toMatchObject({
      meeting_url: "https://meet.google.com/abc-defg-hij",
      bot_name: "Deal Scribe",
    });
    expect(body.automatic_video_output).toEqual({
      in_call_not_recording: {
        kind: "jpeg",
        b64_data: "custom-avatar",
      },
      in_call_recording: {
        kind: "jpeg",
        b64_data: "custom-avatar",
      },
    });
  });

  it("uses the configured Recall API base URL when scheduling bots", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    vi.stubEnv("RECALL_API_BASE_URL", "https://ap-northeast-1.recall.ai/");
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

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ap-northeast-1.recall.ai/api/v1/bot/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updates a scheduled Recall bot with changed calendar meeting details", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "bot_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateScheduledRecallBot({
        botId: "bot_123",
        meetingUrl: "https://meet.google.com/new-link",
        startAt: "2026-06-30T13:00:00.000Z",
        metadata: {
          calendarEventId: "calendar_event_123",
          meetingId: "meeting_123",
        },
      }),
    ).resolves.toEqual({ id: "bot_123" });

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://us-east-1.recall.ai/api/v1/bot/bot_123/",
    );
    expect(init).toMatchObject({
      method: "PATCH",
      headers: {
        Authorization: "Token recall-key",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    expect(JSON.parse(String(init.body))).toEqual({
      meeting_url: "https://meet.google.com/new-link",
      join_at: "2026-06-30T13:00:00.000Z",
      automatic_video_output: {
        in_call_not_recording: {
          kind: "jpeg",
          b64_data: expect.any(String),
        },
        in_call_recording: {
          kind: "jpeg",
          b64_data: expect.any(String),
        },
      },
      recording_config: {
        realtime_endpoints: [
          {
            type: "webhook",
            url: "https://app.example.com/api/recall/realtime/webhook",
            events: [
              "participant_events.chat_message",
              "participant_events.speech_on",
              "participant_events.speech_off",
            ],
          },
        ],
      },
      metadata: {
        calendarEventId: "calendar_event_123",
        meetingId: "meeting_123",
      },
    });
  });

  it("sends chat replies through Recall", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "bot_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendRecallChatMessage({
      botId: "bot_123",
      message: "Answer from the bot",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v1/bot/bot_123/send_chat_message/",
      {
        method: "POST",
        headers: {
          Authorization: "Token recall-key",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ message: "Answer from the bot" }),
      },
    );
  });

  it("gets meeting chat answers from OpenRouter", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-key\n");
    vi.stubEnv("OPENROUTER_MODEL", "qwen/qwen3.7-plus");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Here is the answer." } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateOpenRouterChatReply({
        question: "What did we decide?",
        participantName: "Alice",
      }),
    ).resolves.toBe("Here is the answer.");

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer openrouter-key",
        "Content-Type": "application/json",
        Accept: "application/json",
        "HTTP-Referer": "https://app.example.com",
        "X-Title": "Meeting Note",
      },
    });
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "qwen/qwen3.7-plus",
      messages: [
        expect.objectContaining({ role: "system" }),
        {
          role: "user",
          content: "Alice asked in the meeting chat:\nWhat did we decide?",
        },
      ],
    });
  });

  it("deletes a scheduled Recall bot before it joins", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteScheduledRecallBot({ botId: "bot_123" })).resolves.toEqual(
      {},
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v1/bot/bot_123/",
      {
        method: "DELETE",
        headers: {
          Authorization: "Token recall-key",
          Accept: "application/json",
        },
      },
    );
  });

  it("retrieves Recall bot details", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "bot_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(retrieveRecallBot("bot_123")).resolves.toEqual({
      id: "bot_123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v1/bot/bot_123/",
      {
        method: "GET",
        headers: {
          Authorization: "Token recall-key",
          Accept: "application/json",
        },
      },
    );
  });

  it("lists and normalizes Recall bot screenshots", async () => {
    vi.stubEnv("RECALL_API_KEY", "recall-key\n");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              id: "screenshot_123",
              recorded_at: "2026-06-29T14:01:05.000Z",
              data: {
                download_url: "https://recall.example.com/screenshot.jpg",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listRecallBotScreenshots("bot_123")).resolves.toEqual([
      {
        id: "screenshot_123",
        capturedAt: "2026-06-29T14:01:05.000Z",
        downloadUrl: "https://recall.example.com/screenshot.jpg",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-east-1.recall.ai/api/v1/bot/bot_123/screenshots/",
      {
        method: "GET",
        headers: {
          Authorization: "Token recall-key",
          Accept: "application/json",
        },
      },
    );
  });

  it("extracts Recall bot screenshots from alternate payload shapes", () => {
    expect(
      extractRecallBotScreenshots({
        screenshots: [
          {
            uuid: "screenshot_456",
            timestamp: "2026-06-29T14:02:10.000Z",
            image_url: "https://recall.example.com/alternate.png",
          },
        ],
      }),
    ).toEqual([
      {
        id: "screenshot_456",
        capturedAt: "2026-06-29T14:02:10.000Z",
        downloadUrl: "https://recall.example.com/alternate.png",
      },
    ]);
  });

  it("extracts Recall recording media URLs", () => {
    expect(
      findRecallRecordingMediaUrl(
        {
          recordings: [
            {
              id: "rec_old",
              media_shortcuts: {
                video_mixed: {
                  data: { download_url: "https://recall.example.com/old.mp4" },
                },
              },
            },
            {
              id: "rec_123",
              media_shortcuts: {
                video_mixed: {
                  data: {
                    download_url: "https://recall.example.com/recording.mp4",
                  },
                },
              },
            },
          ],
        },
        "rec_123",
      ),
    ).toBe("https://recall.example.com/recording.mp4");
  });

  it("extracts Recall speaker timeline URLs", () => {
    expect(
      findRecallSpeakerTimelineUrl(
        {
          recordings: [
            {
              id: "rec_123",
              media_shortcuts: {
                participant_events: {
                  data: {
                    speaker_timeline_download_url:
                      "https://recall.example.com/speaker-timeline.json",
                  },
                },
              },
            },
          ],
        },
        "rec_123",
      ),
    ).toBe("https://recall.example.com/speaker-timeline.json");
  });
});
