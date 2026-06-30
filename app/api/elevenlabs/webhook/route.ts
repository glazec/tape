import {
  getElevenLabsWebhookIdempotencyKey,
  normalizeElevenLabsWebhook,
} from "@/lib/vendors/elevenlabs";
import {
  markVendorWebhookEventProcessed,
  MissingWebhookIdempotencyKeyError,
  recordVendorWebhookEvent,
} from "@/lib/vendor-webhook-events";
import { applyElevenLabsTranscriptEvent } from "@/lib/elevenlabs-transcripts";
import { inngest } from "@/inngest/client";
import {
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationQueued,
} from "@/lib/meeting-translation-jobs";
import { shouldAutoTranslateTranscript } from "@/lib/meeting-translation-language";
import {
  verifyElevenLabsWebhook,
  webhookVerificationResponse,
} from "@/lib/webhook-signatures";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: unknown;

  try {
    body = await verifyElevenLabsWebhook(rawBody, request.headers);
  } catch (error) {
    return webhookVerificationResponse(error);
  }

  let event: ReturnType<typeof normalizeElevenLabsWebhook>;

  try {
    event = normalizeElevenLabsWebhook(body);
  } catch {
    return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  try {
    const idempotencyKey = getElevenLabsWebhookIdempotencyKey(event) ?? "";
    const recorded = await recordVendorWebhookEvent({
      provider: "elevenlabs",
      eventType: event.eventType,
      idempotencyKey,
      payload: body,
    });

    if (recorded.shouldProcess) {
      const persistence = await applyElevenLabsTranscriptEvent(event);

      if (persistence.action === "complete") {
        const translateToChinese = shouldAutoTranslateTranscript(
          persistence.text,
        );

        if (translateToChinese) {
          await markMeetingTranslationQueued(persistence.meetingId);
        } else {
          await markMeetingTranslationCompleted(persistence.meetingId);
        }

        await inngest
          .send({
            name: "meeting/enrich.transcript",
            data: {
              meetingId: persistence.meetingId,
              translateToChinese,
            },
          })
          .catch((error) =>
            translateToChinese
              ? markMeetingTranslationFailed(persistence.meetingId, error)
              : Promise.reject(error),
          );
      }

      await markVendorWebhookEventProcessed({
        provider: "elevenlabs",
        idempotencyKey,
      });
    }

    return Response.json({ received: true, event });
  } catch (error) {
    if (error instanceof MissingWebhookIdempotencyKeyError) {
      return Response.json(
        { error: "Invalid webhook payload" },
        { status: 400 },
      );
    }

    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
