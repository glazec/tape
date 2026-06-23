import { z } from "zod";

const elevenLabsWebhookSchema = z.object({
  event: z.string().min(1),
  transcript_id: z.string().min(1).optional().nullable(),
  status: z.string().min(1).optional().nullable(),
});

const elevenLabsTranscriptInputSchema = z.object({
  audioUrl: z.string().url(),
  webhookUrl: z.string().url(),
});

const elevenLabsApiEnvSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1),
});

export function normalizeElevenLabsWebhook(payload: unknown) {
  const parsed = elevenLabsWebhookSchema.parse(payload);

  return {
    eventType: parsed.event,
    transcriptId: parsed.transcript_id ?? null,
    status: parsed.status ?? null,
  };
}

export async function createElevenLabsTranscriptJob(input: {
  audioUrl: string;
  webhookUrl: string;
}) {
  const parsedInput = elevenLabsTranscriptInputSchema.parse(input);
  const env = elevenLabsApiEnvSchema.parse(process.env);
  const body = new FormData();

  body.append("model_id", "scribe_v2");
  body.append("source_url", parsedInput.audioUrl);
  body.append("webhook", "true");
  body.append(
    "webhook_metadata",
    JSON.stringify({ webhookUrl: parsedInput.webhookUrl }),
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
