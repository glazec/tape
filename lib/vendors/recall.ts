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
    recording: z
      .object({
        id: z.string().min(1),
        metadata: recallMetadataSchema.optional().nullable(),
      })
      .optional()
      .nullable(),
    bot: z.object({
      id: z.string().min(1),
      metadata: recallMetadataSchema.optional().nullable(),
    }),
  }),
});

export const DEFAULT_RECALL_BOT_NAME = "IOSG Old Friend";

const recallBotInputSchema = z.object({
  meetingUrl: z.string().url(),
  botName: z.string().trim().min(1).max(100).default(DEFAULT_RECALL_BOT_NAME),
  startAt: z.string().datetime().optional(),
  webhookUrl: z.string().url(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallBotUpdateInputSchema = z.object({
  botId: z.string().trim().min(1),
  meetingUrl: z.string().url(),
  startAt: z.string().datetime(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallBotDeleteInputSchema = z.object({
  botId: z.string().trim().min(1),
});

const optionalRecallApiBaseUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().url().optional(),
);

const recallApiEnvSchema = z.object({
  RECALL_API_KEY: z.string().trim().min(1),
  RECALL_API_BASE_URL: optionalRecallApiBaseUrl,
});

const DEFAULT_RECALL_API_BASE_URL = "https://us-east-1.recall.ai";

export function normalizeRecallWebhook(payload: unknown) {
  const realPayload = recallWebhookSchema.safeParse(payload);

  if (realPayload.success) {
    return {
      eventType: realPayload.data.event,
      botId: realPayload.data.data.bot.id,
      recordingId: realPayload.data.data.recording?.id ?? null,
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

export function getRecallWebhookIdempotencyKey(
  event: ReturnType<typeof normalizeRecallWebhook>,
  headers: Headers,
) {
  return (
    headers.get("webhook-id") ??
    headers.get("svix-id") ??
    event.botId ??
    event.recordingId ??
    null
  );
}

export async function scheduleRecallBot(input: {
  meetingUrl: string;
  botName?: string;
  startAt?: string;
  webhookUrl: string;
  metadata?: Record<string, string>;
}) {
  const parsedInput = recallBotInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(buildRecallApiUrl(env, "/api/v1/bot/"), {
    method: "POST",
    headers: {
      Authorization: `Token ${env.RECALL_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      meeting_url: parsedInput.meetingUrl,
      bot_name: parsedInput.botName,
      join_at: parsedInput.startAt,
      metadata: {
        // Recall delivers bot status webhooks to dashboard configured endpoints. This metadata only correlates the request with our app URL.
        requested_webhook_url: parsedInput.webhookUrl,
        ...parsedInput.metadata,
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

export async function updateScheduledRecallBot(input: {
  botId: string;
  meetingUrl: string;
  startAt: string;
  metadata?: Record<string, string>;
}) {
  const parsedInput = recallBotUpdateInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(
    buildRecallApiUrl(env, `/api/v1/bot/${encodeURIComponent(parsedInput.botId)}/`),
    {
      method: "PATCH",
      headers: {
        Authorization: `Token ${env.RECALL_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        meeting_url: parsedInput.meetingUrl,
        join_at: parsedInput.startAt,
        metadata: parsedInput.metadata,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall bot update failed with ${response.status} ${response.statusText}`,
    );
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
}

export async function deleteScheduledRecallBot(input: { botId: string }) {
  const parsedInput = recallBotDeleteInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(
    buildRecallApiUrl(env, `/api/v1/bot/${encodeURIComponent(parsedInput.botId)}/`),
    {
      method: "DELETE",
      headers: {
        Authorization: `Token ${env.RECALL_API_KEY}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall bot deletion failed with ${response.status} ${response.statusText}`,
    );
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
}

export async function retrieveRecallBot(botId: string) {
  const env = recallApiEnvSchema.parse(process.env);
  const response = await fetch(buildRecallApiUrl(env, `/api/v1/bot/${botId}/`), {
    method: "GET",
    headers: {
      Authorization: `Token ${env.RECALL_API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Recall bot retrieval failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

function buildRecallApiUrl(
  env: z.infer<typeof recallApiEnvSchema>,
  pathname: string,
) {
  return new URL(
    pathname,
    env.RECALL_API_BASE_URL ?? DEFAULT_RECALL_API_BASE_URL,
  ).toString();
}

export function findRecallRecordingMediaUrl(
  bot: unknown,
  recordingId?: string | null,
) {
  if (!bot || typeof bot !== "object") {
    return null;
  }

  const recordings = (bot as { recordings?: unknown }).recordings;

  if (!Array.isArray(recordings)) {
    return null;
  }

  for (const recording of recordings) {
    if (!recording || typeof recording !== "object") {
      continue;
    }

    const candidate = recording as {
      id?: unknown;
      media_shortcuts?: Record<string, unknown>;
    };

    if (recordingId && candidate.id !== recordingId) {
      continue;
    }

    for (const shortcut of ["audio_mixed", "video_mixed"]) {
      const url = getDownloadUrl(candidate.media_shortcuts?.[shortcut]);

      if (url) {
        return url;
      }
    }
  }

  return null;
}

function getDownloadUrl(mediaShortcut: unknown) {
  if (!mediaShortcut || typeof mediaShortcut !== "object") {
    return null;
  }

  const data = (mediaShortcut as { data?: unknown }).data;

  if (!data || typeof data !== "object") {
    return null;
  }

  const downloadUrl = (data as { download_url?: unknown }).download_url;

  return typeof downloadUrl === "string" && downloadUrl.trim()
    ? downloadUrl.trim()
    : null;
}
