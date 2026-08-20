import { afterEach, describe, expect, it, vi } from "vitest";

const {
  applyElevenLabsTranscriptEvent,
  getMeetingTranslationLanguage,
  inngestSend,
  logWebhookProcessingError,
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationQueued,
  markVendorWebhookEventProcessed,
  normalizeElevenLabsWebhook,
  recordVendorWebhookEvent,
  releaseVendorWebhookEventClaim,
  reopenTranscriptJobForEnrichmentRetry,
  shouldAutoTranslateTranscript,
  verifyElevenLabsWebhook,
} = vi.hoisted(() => ({
  applyElevenLabsTranscriptEvent: vi.fn(),
  getMeetingTranslationLanguage: vi.fn(),
  inngestSend: vi.fn(),
  logWebhookProcessingError: vi.fn(),
  markMeetingTranslationCompleted: vi.fn(),
  markMeetingTranslationFailed: vi.fn(),
  markMeetingTranslationQueued: vi.fn(),
  markVendorWebhookEventProcessed: vi.fn(),
  normalizeElevenLabsWebhook: vi.fn(),
  recordVendorWebhookEvent: vi.fn(),
  releaseVendorWebhookEventClaim: vi.fn(),
  reopenTranscriptJobForEnrichmentRetry: vi.fn(),
  shouldAutoTranslateTranscript: vi.fn(),
  verifyElevenLabsWebhook: vi.fn(),
}));

vi.mock("@/lib/vendors/elevenlabs", () => ({
  getElevenLabsWebhookIdempotencyKey: () => "webhook_123",
  normalizeElevenLabsWebhook,
}));
vi.mock("@/lib/vendor-webhook-events", () => ({
  markVendorWebhookEventProcessed,
  MissingWebhookIdempotencyKeyError: class extends Error {},
  recordVendorWebhookEvent,
  releaseVendorWebhookEventClaim,
}));
vi.mock("@/lib/elevenlabs-transcripts", () => ({
  applyElevenLabsTranscriptEvent,
  reopenTranscriptJobForEnrichmentRetry,
}));
vi.mock("@/inngest/client", () => ({
  inngest: { send: inngestSend },
}));
vi.mock("@/lib/meeting-translation-jobs", () => ({
  markMeetingTranslationCompleted,
  markMeetingTranslationFailed,
  markMeetingTranslationQueued,
}));
vi.mock("@/lib/meeting-translation-language", () => ({
  shouldAutoTranslateTranscript,
}));
vi.mock("@/lib/team-configuration", () => ({
  getMeetingTranslationLanguage,
}));
vi.mock("@/lib/webhook-signatures", () => ({
  verifyElevenLabsWebhook,
  webhookVerificationResponse: vi.fn(),
}));
vi.mock("@/lib/webhook-error-logging", () => ({
  logWebhookProcessingError,
}));

describe("ElevenLabs webhook enrichment dispatch", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([true, false])(
    "reopens the transcript job when dispatch fails with translation=%s",
    async (translateTranscript) => {
      const event = { eventType: "speech_to_text_transcription" };
      const processingStartedAt = new Date("2026-08-15T12:00:00.000Z");
      verifyElevenLabsWebhook.mockResolvedValue({ event: "payload" });
      normalizeElevenLabsWebhook.mockReturnValue(event);
      recordVendorWebhookEvent.mockResolvedValue({
        processed: false,
        processingStartedAt,
        shouldProcess: true,
      });
      applyElevenLabsTranscriptEvent.mockResolvedValue({
        action: "complete",
        meetingId: "11111111-1111-4111-8111-111111111111",
        text: "Transcript text",
        transcriptJobId: "22222222-2222-4222-8222-222222222222",
      });
      getMeetingTranslationLanguage.mockResolvedValue("en");
      shouldAutoTranslateTranscript.mockReturnValue(translateTranscript);
      inngestSend.mockRejectedValue(new Error("Inngest unavailable"));
      reopenTranscriptJobForEnrichmentRetry.mockResolvedValue(undefined);
      releaseVendorWebhookEventClaim.mockResolvedValue(undefined);
      markMeetingTranslationCompleted.mockResolvedValue(undefined);
      markMeetingTranslationFailed.mockResolvedValue(undefined);
      markMeetingTranslationQueued.mockResolvedValue(undefined);
      const { POST } = await import("@/app/api/elevenlabs/webhook/route");

      const response = await POST(
        new Request("https://tape.example.com/api/elevenlabs/webhook", {
          body: "{}",
          method: "POST",
        }),
      );

      expect(response.status).toBe(500);
      expect(inngestSend).toHaveBeenCalledWith({
        id: "transcript-enrichment:22222222-2222-4222-8222-222222222222",
        name: "meeting/enrich.transcript",
        data: {
          meetingId: "11111111-1111-4111-8111-111111111111",
          translateTranscript,
          translationLanguage: "en",
        },
      });
      expect(reopenTranscriptJobForEnrichmentRetry).toHaveBeenCalledWith(
        "22222222-2222-4222-8222-222222222222",
      );
      expect(releaseVendorWebhookEventClaim).toHaveBeenCalledWith({
        idempotencyKey: "webhook_123",
        processingStartedAt,
        provider: "elevenlabs",
      });
      expect(markVendorWebhookEventProcessed).not.toHaveBeenCalled();

      if (translateTranscript) {
        expect(markMeetingTranslationFailed).toHaveBeenCalledOnce();
      } else {
        expect(markMeetingTranslationCompleted).toHaveBeenCalledWith(
          "11111111-1111-4111-8111-111111111111",
          "en",
        );
        expect(markMeetingTranslationFailed).not.toHaveBeenCalled();
      }
    },
  );
});
