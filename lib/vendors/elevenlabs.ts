import { z } from "zod";

import { buildTranscriptionKeyterms } from "@/lib/meeting-intelligence";

const oldElevenLabsWebhookSchema = z.object({
  event: z.string().min(1),
  transcript_id: z.string().min(1).optional().nullable(),
  status: z.string().min(1).optional().nullable(),
});

const transcriptionSchema = z.union([
  z.string().min(1),
  z.looseObject({
    text: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
  }),
]);

const transcriptionWordSchema = z.looseObject({
  text: z.string(),
  type: z.string().optional().nullable(),
  start: z.number().optional().nullable(),
  end: z.number().optional().nullable(),
  speaker_id: z.string().optional().nullable(),
});

const transcriptionEntitySchema = z.looseObject({
  entity_type: z.string().optional().nullable(),
  end_char: z.number().optional().nullable(),
  text: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
  start_char: z.number().optional().nullable(),
  value: z.string().optional().nullable(),
  start: z.number().optional().nullable(),
  end: z.number().optional().nullable(),
});

const elevenLabsWebhookSchema = z.object({
  type: z.string().min(1),
  data: z.object({
    request_id: z.string().min(1),
    webhook_metadata: z.record(z.string(), z.unknown()).optional().nullable(),
    transcription: transcriptionSchema.optional().nullable(),
  }),
});

const elevenLabsTranscriptInputSchema = z.object({
  audioUrl: z.url(),
  webhookUrl: z.url(),
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
    const transcriptionEntities =
      typeof transcription === "object" && transcription !== null
        ? normalizeTranscriptionEntities(transcription.entities)
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
      ...(transcriptionEntities ? { transcriptionEntities } : {}),
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
  body.append("entity_detection", "all");
  body.append("timestamps_granularity", "word");
  for (const keyterm of buildTranscriptionKeyterms(parsedInput.keyterms ?? [])) {
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
    throw new Error(await buildElevenLabsErrorMessage(response));
  }

  return response.json();
}

async function buildElevenLabsErrorMessage(response: Response) {
  const baseMessage = `ElevenLabs transcript job failed with ${response.status} ${response.statusText}`;
  const body = (await response.text().catch(() => "")).trim();

  if (!body) {
    return baseMessage;
  }

  return `${baseMessage}: ${body.slice(0, 1000)}`;
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

function normalizeTranscriptionEntities(entities: unknown) {
  if (!Array.isArray(entities)) {
    return undefined;
  }

  const normalizedEntities = entities
    .map((entity) => {
      const parsed = transcriptionEntitySchema.safeParse(entity);

      if (!parsed.success) {
        return null;
      }

      const value = parsed.data.text ?? parsed.data.value;
      const type = parsed.data.entity_type ?? parsed.data.type;

      if (!value || !type) {
        return null;
      }

      return {
        source: "elevenlabs" as const,
        type,
        value,
        start: parsed.data.start_char ?? parsed.data.start ?? null,
        end: parsed.data.end_char ?? parsed.data.end ?? null,
      };
    })
    .filter((entity) => entity !== null);

  return normalizedEntities.length > 0 ? normalizedEntities : undefined;
}
