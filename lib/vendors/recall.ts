import { z } from "zod";

const recallWebhookSchema = z.object({
  event: z.string().min(1),
  data: z
    .object({
      bot_id: z.string().min(1).optional().nullable(),
      recording_id: z.string().min(1).optional().nullable(),
      meeting_url: z.string().url().optional().nullable(),
    })
    .optional()
    .default({}),
});

const recallBotInputSchema = z.object({
  meetingUrl: z.string().url(),
  startAt: z.string().datetime().optional(),
  webhookUrl: z.string().url(),
});

const recallApiEnvSchema = z.object({
  RECALL_API_KEY: z.string().min(1),
});

export function normalizeRecallWebhook(payload: unknown) {
  const parsed = recallWebhookSchema.parse(payload);

  return {
    eventType: parsed.event,
    botId: parsed.data.bot_id ?? null,
    recordingId: parsed.data.recording_id ?? null,
    meetingUrl: parsed.data.meeting_url ?? null,
  };
}

export async function scheduleRecallBot(input: {
  meetingUrl: string;
  startAt?: string;
  webhookUrl: string;
}) {
  const parsedInput = recallBotInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch("https://us-east-1.recall.ai/api/v1/bot/", {
    method: "POST",
    headers: {
      Authorization: `Token ${env.RECALL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      meeting_url: parsedInput.meetingUrl,
      join_at: parsedInput.startAt,
      metadata: {
        webhook_url: parsedInput.webhookUrl,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Recall bot scheduling failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}
