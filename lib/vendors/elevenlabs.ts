import { z } from "zod";

const oldElevenLabsWebhookSchema = z.object({
  event: z.string().min(1),
  transcript_id: z.string().min(1).optional().nullable(),
  status: z.string().min(1).optional().nullable(),
});

const transcriptionSchema = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
    })
    .passthrough(),
]);

const transcriptionWordSchema = z
  .object({
    text: z.string(),
    type: z.string().optional().nullable(),
    start: z.number().optional().nullable(),
    end: z.number().optional().nullable(),
    speaker_id: z.string().optional().nullable(),
  })
  .passthrough();

const elevenLabsWebhookSchema = z.object({
  type: z.string().min(1),
  data: z.object({
    request_id: z.string().min(1),
    webhook_metadata: z.record(z.string(), z.unknown()).optional().nullable(),
    transcription: transcriptionSchema.optional().nullable(),
  }),
});

const elevenLabsTranscriptInputSchema = z.object({
  audioUrl: z.string().url(),
  webhookUrl: z.string().url(),
  keyterms: z.array(z.string().trim().min(1)).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const elevenLabsApiEnvSchema = z.object({
  ELEVENLABS_API_KEY: z.string().trim().min(1),
});

export function normalizeElevenLabsWebhook(payload: unknown) {
  const realPayload = elevenLabsWebhookSchema.safeParse(payload);

  if (realPayload.success) {
    const transcription = realPayload.data.data.transcription ?? null;
    const transcriptionText =
      typeof transcription === "string"
        ? transcription
        : (transcription?.text ?? null);
    const transcriptionWords =
      typeof transcription === "object" && transcription !== null
        ? normalizeTranscriptionWords(transcription.words)
        : undefined;
    const status =
      typeof transcription === "object" && transcription !== null
        ? (transcription.status ?? "completed")
        : "completed";

    return {
      eventType: realPayload.data.type,
      type: realPayload.data.type,
      requestId: realPayload.data.data.request_id,
      transcriptId: null,
      status,
      transcriptionText,
      ...(transcriptionWords ? { transcriptionWords } : {}),
      metadata: realPayload.data.data.webhook_metadata ?? {},
    };
  }

  const parsed = oldElevenLabsWebhookSchema.parse(payload);

  return {
    eventType: parsed.event,
    type: parsed.event,
    requestId: null,
    transcriptId: parsed.transcript_id ?? null,
    status: parsed.status ?? null,
    transcriptionText: null,
    metadata: {},
  };
}

export function getElevenLabsWebhookIdempotencyKey(
  event: ReturnType<typeof normalizeElevenLabsWebhook>,
) {
  return event.requestId ?? event.transcriptId ?? null;
}

export async function createElevenLabsTranscriptJob(input: {
  audioUrl: string;
  webhookUrl: string;
  keyterms?: string[];
  metadata?: Record<string, string>;
}) {
  const parsedInput = elevenLabsTranscriptInputSchema.parse(input);
  const env = elevenLabsApiEnvSchema.parse(process.env);
  const body = new FormData();

  body.append("model_id", "scribe_v2");
  body.append("source_url", parsedInput.audioUrl);
  body.append("webhook", "true");
  body.append("diarize", "true");
  body.append("detect_entities", "true");
  body.append("timestamps_granularity", "word");
  for (const keyterm of parsedInput.keyterms ?? []) {
    body.append("keyterms", keyterm);
  }
  // ElevenLabs delivers webhooks to workspace configured endpoints. This metadata only correlates the request with our app URL.
  body.append(
    "webhook_metadata",
    JSON.stringify({
      requestedWebhookUrl: parsedInput.webhookUrl,
      ...parsedInput.metadata,
    }),
  );

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `ElevenLabs transcript job failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

function normalizeTranscriptionWords(words: unknown) {
  if (!Array.isArray(words)) {
    return undefined;
  }

  const normalizedWords = words
    .map((word) => {
      const parsed = transcriptionWordSchema.safeParse(word);

      if (!parsed.success) {
        return null;
      }

      return {
        text: parsed.data.text,
        type: parsed.data.type ?? null,
        start: parsed.data.start ?? null,
        end: parsed.data.end ?? null,
        speakerId: parsed.data.speaker_id ?? null,
      };
    })
    .filter((word) => word !== null);

  return normalizedWords.length > 0 ? normalizedWords : undefined;
}
