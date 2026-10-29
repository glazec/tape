import {
  getRecallWebhookIdempotencyKey,
  normalizeRecallWebhook,
} from "@/lib/vendors/recall";
import {
  markVendorWebhookEventProcessed,
  MissingWebhookIdempotencyKeyError,
  recordVendorWebhookEvent,
  releaseVendorWebhookEventClaim,
} from "@/lib/vendor-webhook-events";
import { applyRecallMeetingEvent } from "@/lib/recall-meetings";
import {
  verifyRecallWebhook,
  webhookVerificationResponse,
} from "@/lib/webhook-signatures";
import { logWebhookProcessingError } from "@/lib/webhook-error-logging";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: unknown;

  try {
    verifyRecallWebhook(rawBody, request.headers);
    body = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    return webhookVerificationResponse(error);
  }

  if (body && typeof body === "object" && "event" in body &&
      typeof body.event === "string" && body.event.startsWith("calendar.")) {
    const { handleRecallCalendarWebhook } = await import("@/lib/recall-calendar-webhook-handler");
    return handleRecallCalendarWebhook(new Request(request.url, {
      method: "POST", headers: request.headers, body: rawBody,
    }));
  }

  let event: ReturnType<typeof normalizeRecallWebhook>;

  try {
    event = normalizeRecallWebhook(body);
  } catch {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  const idempotencyKey =
    getRecallWebhookIdempotencyKey(event, request.headers) ?? "";
  let processingStartedAt: Date | null = null;

  try {
    const recorded = await recordVendorWebhookEvent({
      provider: "recall",
      eventType: event.eventType,
      idempotencyKey,
      payload: body,
    });

    if (!recorded.shouldProcess && recorded.processed === false) {
      return Response.json(
        {
          received: false,
          result: { action: "retry", reason: "processing" },
        },
        { status: 503 },
      );
    }

    if (recorded.shouldProcess) {
      if (!recorded.processingStartedAt) {
        throw new Error("Recall webhook processing claim is missing");
      }

      processingStartedAt = recorded.processingStartedAt;
      await applyRecallMeetingEvent(event);
      await markVendorWebhookEventProcessed({
        provider: "recall",
        idempotencyKey,
      });
    }

    return Response.json({ received: true, event });
  } catch (error) {
    if (idempotencyKey && processingStartedAt) {
      await releaseVendorWebhookEventClaim({
        provider: "recall",
        idempotencyKey,
        processingStartedAt,
      }).catch(() => undefined);
    }

    if (error instanceof MissingWebhookIdempotencyKeyError) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    logWebhookProcessingError("Recall webhook processing failed", {
      eventType: event.eventType,
      idempotencyKey,
      error,
    });

    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
