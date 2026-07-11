import { createHash, createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  answerRecallChatMessage,
  persistRecallRealtimeParticipantTimelineEvent,
  markVendorWebhookEventProcessed,
  recordVendorWebhookEvent,
  MissingWebhookIdempotencyKeyError,
} = vi.hoisted(() => ({
  answerRecallChatMessage: vi.fn(),
  persistRecallRealtimeParticipantTimelineEvent: vi.fn(),
  markVendorWebhookEventProcessed: vi.fn(),
  recordVendorWebhookEvent: vi.fn(),
  MissingWebhookIdempotencyKeyError: class MissingWebhookIdempotencyKeyError extends Error {
    constructor() {
      super("Missing webhook idempotency key");
    }
  },
}));

vi.mock("@/lib/recall-chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/recall-chat")>();

  return {
    ...actual,
    answerRecallChatMessage,
  };
});

vi.mock("@/lib/vendor-webhook-events", () => ({
  MissingWebhookIdempotencyKeyError,
  markVendorWebhookEventProcessed,
  recordVendorWebhookEvent,
}));

vi.mock("@/lib/meeting-participant-timeline", () => ({
  persistRecallRealtimeParticipantTimelineEvent,
}));

const recallWebhookSecret = "whsec_cmVjYWxsLXdlYmhvb2stc2VjcmV0";

function signRecallWebhook(rawBody: string) {
  const messageId = "msg_chat";
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

async function postRecallChatWebhook(body: unknown, signed = true) {
  vi.stubEnv("RECALL_WEBHOOK_SECRET", recallWebhookSecret);
  const { POST } = await import("@/app/api/recall/chat/webhook/route");
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (signed) {
    Object.assign(headers, signRecallWebhook(rawBody));
  }

  return POST(
    new Request("https://app.example.com/api/recall/chat/webhook", {
      method: "POST",
      body: rawBody,
      headers,
    }),
  );
}

async function postRecallRealtimeWebhook(body: unknown, signed = true) {
  vi.stubEnv("RECALL_WEBHOOK_SECRET", recallWebhookSecret);
  const { POST } = await import("@/app/api/recall/realtime/webhook/route");
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (signed) {
    Object.assign(headers, signRecallWebhook(rawBody));
  }

  return POST(
    new Request("https://app.example.com/api/recall/realtime/webhook", {
      method: "POST",
      body: rawBody,
      headers,
    }),
  );
}

function getDesktopRealtimeWebhookToken() {
  const key = Buffer.from(recallWebhookSecret.slice("whsec_".length), "base64");

  return createHmac("sha256", key)
    .update("meeting-note:recall-desktop-realtime:v1")
    .digest("base64url");
}

async function postRecallDesktopRealtimeWebhook(
  body: unknown,
  token = getDesktopRealtimeWebhookToken(),
) {
  vi.stubEnv("RECALL_WEBHOOK_SECRET", recallWebhookSecret);
  const { POST } = await import("@/app/api/recall/realtime/webhook/route");
  const rawBody = JSON.stringify(body);

  return POST(
    new Request(
      `https://app.example.com/api/recall/realtime/webhook/?token=${token}`,
      {
        method: "POST",
        body: rawBody,
        headers: { "content-type": "application/json" },
      },
    ),
  );
}

const chatPayload = {
  event: "participant_events.chat_message",
  data: {
    data: {
      participant: {
        id: 7,
        name: "Alice",
        is_host: false,
        platform: "desktop",
        extra_data: {},
        email: "alice@example.com",
      },
      timestamp: {
        absolute: "2026-06-27T16:00:00.000Z",
        relative: 12.5,
      },
      data: {
        text: "@IOSG Old Friend what did we decide?",
        to: "everyone",
      },
    },
    bot: {
      id: "bot_123",
      metadata: {
        meetingId: "11111111-1111-4111-8111-111111111111",
      },
    },
  },
};

describe("POST /api/recall/chat/webhook", () => {
  beforeEach(() => {
    recordVendorWebhookEvent.mockResolvedValue({
      inserted: true,
      shouldProcess: true,
    });
    markVendorWebhookEventProcessed.mockResolvedValue(undefined);
    answerRecallChatMessage.mockResolvedValue({
      action: "replied",
      reply: "We decided to follow up next week.",
    });
    persistRecallRealtimeParticipantTimelineEvent.mockResolvedValue({
      action: "speech_on",
      entry: {
        email: null,
        endMs: null,
        meetingId: "11111111-1111-4111-8111-111111111111",
        name: "Alice",
        participantId: "7",
        startMs: 12500,
      },
    });
  });

  afterEach(() => {
    recordVendorWebhookEvent.mockReset();
    markVendorWebhookEventProcessed.mockReset();
    answerRecallChatMessage.mockReset();
    persistRecallRealtimeParticipantTimelineEvent.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("processes signed chat messages and marks the delivery processed", async () => {
    const response = await postRecallChatWebhook(chatPayload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      received: true,
      result: {
        action: "replied",
      },
    });
    expect(recordVendorWebhookEvent).toHaveBeenCalledWith({
      provider: "recall",
      eventType: "participant_events.chat_message",
      idempotencyKey: "msg_chat",
      payload: chatPayload,
      processingClaimTimeoutMs: 30_000,
    });
    expect(answerRecallChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: "bot_123",
        text: "@IOSG Old Friend what did we decide?",
      }),
    );
    expect(markVendorWebhookEventProcessed).toHaveBeenCalledWith({
      provider: "recall",
      idempotencyKey: "msg_chat",
    });
  });

  it("does not answer duplicate chat webhook deliveries", async () => {
    recordVendorWebhookEvent.mockResolvedValue({
      inserted: false,
      processed: true,
      shouldProcess: false,
    });

    const response = await postRecallChatWebhook(chatPayload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      result: {
        action: "skipped",
        reason: "duplicate",
      },
    });
    expect(answerRecallChatMessage).not.toHaveBeenCalled();
    expect(markVendorWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("asks Recall to retry unfinished duplicate chat webhook deliveries", async () => {
    recordVendorWebhookEvent.mockResolvedValue({
      inserted: false,
      processed: false,
      shouldProcess: false,
    });

    const response = await postRecallChatWebhook(chatPayload);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      received: false,
      result: {
        action: "retry",
        reason: "processing",
      },
    });
    expect(answerRecallChatMessage).not.toHaveBeenCalled();
    expect(markVendorWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("logs chat webhook processing failures without marking the delivery processed", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    answerRecallChatMessage.mockRejectedValue(new Error("OpenRouter down"));

    try {
      const response = await postRecallChatWebhook(chatPayload);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Webhook processing failed",
      });
      expect(markVendorWebhookEventProcessed).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "Recall realtime webhook processing failed",
        expect.objectContaining({
          eventType: "participant_events.chat_message",
          idempotencyKey: "msg_chat",
        }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("captures signed realtime participant events without answering chat", async () => {
    const payload = {
      event: "participant_events.speech_on",
      data: {
        data: {
          participant: {
            id: 7,
            name: "Alice",
          },
          timestamp: {
            relative: 12.5,
          },
        },
        recording: {
          metadata: {
            meetingId: "11111111-1111-4111-8111-111111111111",
          },
        },
      },
    };

    const response = await postRecallRealtimeWebhook(payload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      result: {
        action: "speech_on",
        entry: {
          email: null,
          endMs: null,
          meetingId: "11111111-1111-4111-8111-111111111111",
          name: "Alice",
          participantId: "7",
          startMs: 12500,
        },
      },
    });
    expect(recordVendorWebhookEvent).toHaveBeenCalledWith({
      provider: "recall",
      eventType: "participant_events.speech_on",
      idempotencyKey: "msg_chat",
      payload,
      processingClaimTimeoutMs: 30_000,
    });
    expect(answerRecallChatMessage).not.toHaveBeenCalled();
    expect(persistRecallRealtimeParticipantTimelineEvent).toHaveBeenCalledWith(
      payload,
    );
    expect(markVendorWebhookEventProcessed).toHaveBeenCalledWith({
      provider: "recall",
      idempotencyKey: "msg_chat",
    });
  });

  it("captures unsigned Desktop SDK participant events with the endpoint token", async () => {
    const payload = {
      event: "participant_events.speech_on",
      data: {
        data: {
          participant: { id: 7, name: "Alice" },
          timestamp: { relative: 12.5 },
        },
        recording: {
          metadata: {
            meetingId: "11111111-1111-4111-8111-111111111111",
            source: "local_recorder_sdk",
          },
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const idempotencyKey = `dsdk:${createHash("sha256")
      .update(rawBody)
      .digest("base64url")}`;

    const response = await postRecallDesktopRealtimeWebhook(payload);

    expect(response.status).toBe(200);
    expect(recordVendorWebhookEvent).toHaveBeenCalledWith({
      provider: "recall",
      eventType: "participant_events.speech_on",
      idempotencyKey,
      payload,
      processingClaimTimeoutMs: 30_000,
    });
    expect(persistRecallRealtimeParticipantTimelineEvent).toHaveBeenCalledWith(
      payload,
    );
  });

  it("rejects unsigned realtime events without the Desktop SDK endpoint token", async () => {
    const response = await postRecallDesktopRealtimeWebhook(
      { event: "participant_events.speech_on" },
      "invalid",
    );

    expect(response.status).toBe(401);
    expect(recordVendorWebhookEvent).not.toHaveBeenCalled();
  });
});
