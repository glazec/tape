import {
  answerRecallChatMessage,
  normalizeRecallChatWebhook,
} from "@/lib/recall-chat";
import {
  markVendorWebhookEventProcessed,
  MissingWebhookIdempotencyKeyError,
  recordVendorWebhookEvent,
} from "@/lib/vendor-webhook-events";
import {
  verifyRecallRealtimeWebhook,
  webhookVerificationResponse,
} from "@/lib/webhook-signatures";
import { logWebhookProcessingError } from "@/lib/webhook-error-logging";
import { persistRecallRealtimeParticipantTimelineEvent } from "@/lib/meeting-participant-timeline";

const RECALL_REALTIME_PROCESSING_CLAIM_TIMEOUT_MS = 30 * 1000;

export async function handleRecallRealtimeWebhook(request: Request) {
  const rawBody = await request.text();
  let body: unknown;
  let idempotencyKey: string;

  try {
    idempotencyKey = verifyRecallRealtimeWebhook(rawBody, request);
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

  const eventType = getEventType(body);

  if (!eventType) {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  try {
    const recorded = await recordVendorWebhookEvent({
      provider: "recall",
      eventType,
      idempotencyKey,
      payload: body,
      processingClaimTimeoutMs: RECALL_REALTIME_PROCESSING_CLAIM_TIMEOUT_MS,
    });

    if (!recorded.shouldProcess) {
      if (recorded.processed === false) {
        return Response.json(
          {
            received: false,
            result: { action: "retry", reason: "processing" },
          },
          { status: 503 },
        );
      }

      return Response.json({
        received: true,
        result: { action: "skipped", reason: "duplicate" },
      });
    }

    const result =
      eventType === "participant_events.chat_message"
        ? await answerRecallChatMessage(normalizeRecallChatWebhook(body))
        : await persistRecallRealtimeParticipantTimelineEvent(body);

    await markVendorWebhookEventProcessed({
      provider: "recall",
      idempotencyKey,
    });

    return Response.json({ received: true, result });
  } catch (error) {
    if (error instanceof MissingWebhookIdempotencyKeyError) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    logWebhookProcessingError("Recall realtime webhook processing failed", {
      eventType,
      idempotencyKey,
      error,
    });

    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}

function getEventType(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const event = (payload as { event?: unknown }).event;

  return typeof event === "string" && event.trim() ? event.trim() : null;
}
