import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createElevenLabsTranscriptJob,
  normalizeElevenLabsWebhook,
} from "@/lib/vendors/elevenlabs";
import {
  findRecallRecordingMediaUrl,
  normalizeRecallWebhook,
  retrieveRecallBot,
  scheduleRecallBot,
} from "@/lib/vendors/recall";

const {
  applyElevenLabsTranscriptEvent,
  applyRecallMeetingEvent,
  recordVendorWebhookEvent,
  MissingWebhookIdempotencyKeyError,
} = vi.hoisted(() => ({
    applyElevenLabsTranscriptEvent: vi.fn(),
    applyRecallMeetingEvent: vi.fn(),
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
    recordVendorWebhookEvent,
  };
});

vi.mock("@/lib/elevenlabs-transcripts", () => ({
  applyElevenLabsTranscriptEvent,
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
    recordVendorWebhookEvent.mockResolvedValue({ inserted: true });
    applyElevenLabsTranscriptEvent.mockResolvedValue({ action: "skip" });
    applyRecallMeetingEvent.mockResolvedValue({ action: "skip" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
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
    recordVendorWebhookEvent.mockResolvedValueOnce({ inserted: false });

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
    recordVendorWebhookEvent.mockResolvedValueOnce({ inserted: false });

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
    expect(JSON.parse(String(init.body))).toMatchObject({
      meeting_url: "https://meet.google.com/abc-defg-hij",
      metadata: {
        requested_webhook_url: "https://app.example.com/api/recall/webhook",
      },
    });
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
});
