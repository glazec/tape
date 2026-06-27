import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  MissingWebhookIdempotencyKeyError,
  markVendorWebhookEventProcessed,
  normalizeRecallCalendarWebhook,
  processRecallCalendarWebhook,
  recordVendorWebhookEvent,
} = vi.hoisted(() => ({
  MissingWebhookIdempotencyKeyError: class MissingWebhookIdempotencyKeyError extends Error {
    constructor() {
      super("Missing webhook idempotency key");
    }
  },
  markVendorWebhookEventProcessed: vi.fn(),
  normalizeRecallCalendarWebhook: vi.fn((payload: unknown) => {
    const event = payload as {
      event: string;
      data: { calendar_id: string; last_updated_ts?: string };
    };

    return {
      eventType: event.event,
      calendarId: event.data.calendar_id,
      lastUpdatedTs: event.data.last_updated_ts ?? null,
    };
  }),
  processRecallCalendarWebhook: vi.fn(),
  recordVendorWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/recall-calendar", () => ({
  normalizeRecallCalendarWebhook,
  processRecallCalendarWebhook,
}));

vi.mock("@/lib/vendor-webhook-events", () => ({
  MissingWebhookIdempotencyKeyError,
  markVendorWebhookEventProcessed,
  recordVendorWebhookEvent,
}));

const recallWebhookSecret = "whsec_cmVjYWxsLXdlYmhvb2stc2VjcmV0";

function signRecallWebhook(rawBody: string) {
  const messageId = "msg_calendar_sync";
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

async function postRecallCalendarWebhook(body: unknown, signed = true) {
  vi.stubEnv("RECALL_WEBHOOK_SECRET", recallWebhookSecret);
  const { POST } = await import("@/app/api/recall/calendar/webhook/route");
  const rawBody = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (signed) {
    Object.assign(headers, signRecallWebhook(rawBody));
  }

  return POST(
    new Request("https://app.example.com/api/recall/calendar/webhook", {
      method: "POST",
      body: rawBody,
      headers,
    }),
  );
}

describe("POST /api/recall/calendar/webhook", () => {
  beforeEach(() => {
    recordVendorWebhookEvent.mockResolvedValue({
      inserted: true,
      shouldProcess: true,
    });
    markVendorWebhookEventProcessed.mockResolvedValue(undefined);
    processRecallCalendarWebhook.mockResolvedValue({ action: "synced", count: 1 });
  });

  afterEach(() => {
    markVendorWebhookEventProcessed.mockReset();
    recordVendorWebhookEvent.mockReset();
    normalizeRecallCalendarWebhook.mockClear();
    processRecallCalendarWebhook.mockReset();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("processes signed Recall calendar sync webhooks once", async () => {
    const payload = {
      event: "calendar.sync_events",
      data: {
        calendar_id: "44444444-4444-4444-8444-444444444444",
        last_updated_ts: "2026-06-30T11:00:00.000Z",
      },
    };

    const response = await postRecallCalendarWebhook(payload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      result: { action: "synced", count: 1 },
    });
    expect(recordVendorWebhookEvent).toHaveBeenCalledWith({
      provider: "recall",
      eventType: "calendar.sync_events",
      idempotencyKey: "msg_calendar_sync",
      payload,
    });
    expect(processRecallCalendarWebhook).toHaveBeenCalledWith({
      eventType: "calendar.sync_events",
      calendarId: "44444444-4444-4444-8444-444444444444",
      lastUpdatedTs: "2026-06-30T11:00:00.000Z",
    });
    expect(markVendorWebhookEventProcessed).toHaveBeenCalledWith({
      provider: "recall",
      idempotencyKey: "msg_calendar_sync",
    });
  });

  it("does not process duplicate Recall calendar webhooks", async () => {
    recordVendorWebhookEvent.mockResolvedValue({
      inserted: false,
      shouldProcess: false,
    });

    const response = await postRecallCalendarWebhook({
      event: "calendar.sync_events",
      data: {
        calendar_id: "44444444-4444-4444-8444-444444444444",
        last_updated_ts: "2026-06-30T11:00:00.000Z",
      },
    });

    expect(response.status).toBe(200);
    expect(processRecallCalendarWebhook).not.toHaveBeenCalled();
    expect(markVendorWebhookEventProcessed).not.toHaveBeenCalled();
  });

  it("retries duplicate Recall calendar webhooks when the previous attempt did not finish processing", async () => {
    recordVendorWebhookEvent.mockResolvedValue({
      inserted: false,
      shouldProcess: true,
    });

    const response = await postRecallCalendarWebhook({
      event: "calendar.sync_events",
      data: {
        calendar_id: "44444444-4444-4444-8444-444444444444",
        last_updated_ts: "2026-06-30T11:00:00.000Z",
      },
    });

    expect(response.status).toBe(200);
    expect(processRecallCalendarWebhook).toHaveBeenCalledWith({
      eventType: "calendar.sync_events",
      calendarId: "44444444-4444-4444-8444-444444444444",
      lastUpdatedTs: "2026-06-30T11:00:00.000Z",
    });
    expect(markVendorWebhookEventProcessed).toHaveBeenCalledWith({
      provider: "recall",
      idempotencyKey: "msg_calendar_sync",
    });
  });
});
