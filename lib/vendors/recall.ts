import { z } from "zod";

const oldRecallWebhookSchema = z.object({
  event: z.string().min(1),
  data: z
    .object({
      bot_id: z.string().min(1).optional().nullable(),
      recording_id: z.string().min(1).optional().nullable(),
      meeting_url: z.string().url().optional().nullable(),
    })
    .refine((data) => data.bot_id || data.recording_id || data.meeting_url),
});

const recallMetadataSchema = z.record(z.string(), z.unknown());

const recallWebhookSchema = z.object({
  event: z.string().min(1),
  data: z.object({
    data: z.object({
      code: z.string().min(1),
      sub_code: z.string().min(1).optional().nullable(),
      updated_at: z.string().min(1).optional().nullable(),
    }),
    bot: z.object({
      id: z.string().min(1),
      metadata: recallMetadataSchema.optional().nullable(),
    }),
  }),
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
  const realPayload = recallWebhookSchema.safeParse(payload);

  if (realPayload.success) {
    return {
      eventType: realPayload.data.event,
      botId: realPayload.data.data.bot.id,
      recordingId: null,
      meetingUrl: null,
      statusCode: realPayload.data.data.data.code,
      code: realPayload.data.data.data.code,
      subCode: realPayload.data.data.data.sub_code ?? null,
      updatedAt: realPayload.data.data.data.updated_at ?? null,
      metadata: realPayload.data.data.bot.metadata ?? {},
    };
  }

  const parsed = oldRecallWebhookSchema.parse(payload);

  return {
    eventType: parsed.event,
    botId: parsed.data.bot_id ?? null,
    recordingId: parsed.data.recording_id ?? null,
    meetingUrl: parsed.data.meeting_url ?? null,
    statusCode: null,
    code: null,
    subCode: null,
    updatedAt: null,
    metadata: {},
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
        // Recall delivers bot status webhooks to dashboard configured endpoints. This metadata only correlates the request with our app URL.
        requested_webhook_url: parsedInput.webhookUrl,
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
