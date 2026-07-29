import {
  getElevenLabsWebhookIdempotencyKey,
  normalizeElevenLabsWebhook,
} from "@/lib/vendors/elevenlabs";
import {
  markVendorWebhookEventProcessed,
  MissingWebhookIdempotencyKeyError,
  recordVendorWebhookEvent,
  releaseVendorWebhookEventClaim,
} from "@/lib/vendor-webhook-events";
import { applyElevenLabsTranscriptEvent } from "@/lib/elevenlabs-transcripts";
import { inngest } from "@/inngest/client";
import {
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationQueued,
} from "@/lib/meeting-translation-jobs";
import { shouldAutoTranslateTranscript } from "@/lib/meeting-translation-language";
import { getMeetingTranslationLanguage } from "@/lib/team-configuration";
import {
  verifyElevenLabsWebhook,
  webhookVerificationResponse,
} from "@/lib/webhook-signatures";
import { logWebhookProcessingError } from "@/lib/webhook-error-logging";

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

  const idempotencyKey = getElevenLabsWebhookIdempotencyKey(event) ?? "";
  let processingStartedAt: Date | null = null;

  try {
    const recorded = await recordVendorWebhookEvent({
      provider: "elevenlabs",
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
        throw new Error("ElevenLabs webhook processing claim is missing");
      }

      processingStartedAt = recorded.processingStartedAt;
      const persistence = await applyElevenLabsTranscriptEvent(event);

      if (persistence.action === "complete") {
        const translationLanguage = await getMeetingTranslationLanguage(
          persistence.meetingId,
        );
        const translateTranscript = shouldAutoTranslateTranscript(
          persistence.text,
          translationLanguage,
        );

        if (translateTranscript) {
          await markMeetingTranslationQueued(persistence.meetingId);
        } else {
          await markMeetingTranslationCompleted(
            persistence.meetingId,
            translationLanguage,
          );
        }

        await inngest
          .send({
            name: "meeting/enrich.transcript",
            data: {
              meetingId: persistence.meetingId,
              translateTranscript,
              translationLanguage,
            },
          })
          .catch((error) =>
            translateTranscript
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
    if (idempotencyKey && processingStartedAt) {
      await releaseVendorWebhookEventClaim({
        provider: "elevenlabs",
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

    logWebhookProcessingError("ElevenLabs webhook processing failed", {
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
