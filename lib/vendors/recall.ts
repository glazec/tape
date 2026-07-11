import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { createRecallDesktopRealtimeWebhookToken } from "@/lib/webhook-signatures";

const oldRecallWebhookSchema = z.object({
  event: z.string().min(1),
  data: z
    .object({
      bot_id: z.string().min(1).optional().nullable(),
      recording_id: z.string().min(1).optional().nullable(),
      meeting_url: z.url().optional().nullable(),
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

const recallSdkUploadWebhookSchema = z.object({
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
    sdk_upload: z.object({
      id: z.string().min(1),
      metadata: recallMetadataSchema.optional().nullable(),
    }),
  }),
});

export const DEFAULT_RECALL_BOT_NAME = "IOSG Old Friend";

type RecallVideoOutput = {
  kind: "jpeg";
  b64_data: string;
};

type RecallAutomaticVideoOutput = {
  in_call_not_recording: RecallVideoOutput;
  in_call_recording: RecallVideoOutput;
};

export type RecallBotScreenshot = {
  id: string;
  capturedAt: string | null;
  downloadUrl: string;
};

let recallBotLogoJpegBase64: string | null = null;

export function getDefaultRecallBotVideoOutput(): RecallAutomaticVideoOutput {
  return buildRecallBotVideoOutput(getRecallBotLogoJpegBase64());
}

function buildRecallBotVideoOutput(
  avatarJpegBase64: string,
): RecallAutomaticVideoOutput {
  const logo = avatarJpegBase64;

  return {
    in_call_not_recording: {
      kind: "jpeg",
      b64_data: logo,
    },
    in_call_recording: {
      kind: "jpeg",
      b64_data: logo,
    },
  };
}

function getRecallBotVideoOutput(input?: string | null) {
  if (input) {
    return buildRecallBotVideoOutput(input);
  }

  const logo = getRecallBotLogoJpegBase64();

  return buildRecallBotVideoOutput(logo);
}

const recallBotInputSchema = z.object({
  meetingUrl: z.url(),
  botName: z.string().trim().min(1).max(100).default(DEFAULT_RECALL_BOT_NAME),
  avatarJpegBase64: z.string().trim().min(1).optional(),
  startAt: z.iso.datetime().optional(),
  webhookUrl: z.url(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallBotUpdateInputSchema = z.object({
  botId: z.string().trim().min(1),
  meetingUrl: z.url(),
  botName: z.string().trim().min(1).max(100).optional(),
  avatarJpegBase64: z.string().trim().min(1).optional(),
  startAt: z.iso.datetime(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallChatMessageInputSchema = z.object({
  botId: z.string().trim().min(1),
  message: z.string().trim().min(1).max(4096),
});

const recallDesktopSdkUploadInputSchema = z.object({
  webhookUrl: z.url(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallBotDeleteInputSchema = z.object({
  botId: z.string().trim().min(1),
});

const recallCalendarInputSchema = z.object({
  oauthClientId: z.string().trim().min(1),
  oauthClientSecret: z.string().trim().min(1),
  oauthRefreshToken: z.string().trim().min(1),
  platform: z.enum(["google_calendar", "microsoft_outlook"]),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallCalendarUpdateInputSchema = z.object({
  calendarId: z.string().trim().min(1),
  oauthRefreshToken: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallCalendarEventListInputSchema = z.object({
  calendarId: z.string().trim().min(1),
  updatedAtGte: z.iso.datetime().optional(),
  startTimeGte: z.iso.datetime().optional(),
  isDeleted: z.boolean().optional(),
});

const recallCalendarEventBotInputSchema = z.object({
  calendarEventId: z.string().trim().min(1),
  deduplicationKey: z.string().trim().min(1).max(2000),
  botName: z.string().trim().min(1).max(100).default(DEFAULT_RECALL_BOT_NAME),
  avatarJpegBase64: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const recallCalendarEventBotDeleteInputSchema = z.object({
  calendarEventId: z.string().trim().min(1),
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

const recallApiBaseUrlEnvSchema = z.object({
  RECALL_API_BASE_URL: optionalRecallApiBaseUrl,
});

const DEFAULT_RECALL_API_BASE_URL = "https://us-east-1.recall.ai";
const RECALL_REALTIME_WEBHOOK_PATH = "/api/recall/realtime/webhook";
const RECALL_CHAT_MESSAGE_EVENT = "participant_events.chat_message";
const RECALL_PARTICIPANT_JOIN_EVENT = "participant_events.join";
const RECALL_PARTICIPANT_UPDATE_EVENT = "participant_events.update";
const RECALL_SPEECH_ON_EVENT = "participant_events.speech_on";
const RECALL_SPEECH_OFF_EVENT = "participant_events.speech_off";

function buildRecallRealtimeRecordingConfig(webhookUrl: string) {
  return {
    realtime_endpoints: [
      {
        type: "webhook",
        url: webhookUrl,
        events: [
          RECALL_CHAT_MESSAGE_EVENT,
          RECALL_SPEECH_ON_EVENT,
          RECALL_SPEECH_OFF_EVENT,
        ],
      },
    ],
  };
}

function buildRecallDesktopSdkRealtimeRecordingConfig(
  webhookUrl: string,
  metadata?: Record<string, string>,
) {
  return {
    metadata,
    realtime_endpoints: [
      {
        type: "webhook",
        url: webhookUrl,
        events: [
          RECALL_PARTICIPANT_JOIN_EVENT,
          RECALL_PARTICIPANT_UPDATE_EVENT,
          RECALL_SPEECH_ON_EVENT,
          RECALL_SPEECH_OFF_EVENT,
        ],
      },
    ],
  };
}

function buildRecallRealtimeWebhookUrl(
  sourceUrl?: string,
  options?: { desktopSdk?: boolean },
) {
  const baseUrl = sourceUrl ?? process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is required");
  }

  const url = new URL(
    options?.desktopSdk
      ? `${RECALL_REALTIME_WEBHOOK_PATH}/`
      : RECALL_REALTIME_WEBHOOK_PATH,
    baseUrl,
  );

  if (options?.desktopSdk) {
    url.searchParams.set("token", createRecallDesktopRealtimeWebhookToken());
  }

  return url.toString();
}

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

  const sdkUploadPayload = recallSdkUploadWebhookSchema.safeParse(payload);

  if (sdkUploadPayload.success) {
    return {
      eventType: sdkUploadPayload.data.event,
      botId: null,
      recordingId: sdkUploadPayload.data.data.recording?.id ?? null,
      meetingUrl: null,
      statusCode: sdkUploadPayload.data.data.data.code,
      code: sdkUploadPayload.data.data.data.code,
      subCode: sdkUploadPayload.data.data.data.sub_code ?? null,
      updatedAt: sdkUploadPayload.data.data.data.updated_at ?? null,
      metadata:
        sdkUploadPayload.data.data.sdk_upload.metadata ??
        sdkUploadPayload.data.data.recording?.metadata ??
        {},
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

export function getRecallApiBaseUrl(env?: {
  RECALL_API_BASE_URL?: string | undefined;
}) {
  const parsedEnv = recallApiBaseUrlEnvSchema.parse(
    env ?? (process.env as { RECALL_API_BASE_URL?: string | undefined }),
  );

  return new URL(
    parsedEnv.RECALL_API_BASE_URL ?? DEFAULT_RECALL_API_BASE_URL,
  ).origin;
}

export async function scheduleRecallBot(input: {
  meetingUrl: string;
  botName?: string;
  avatarJpegBase64?: string;
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
      automatic_video_output: getRecallBotVideoOutput(
        parsedInput.avatarJpegBase64,
      ),
      recording_config: buildRecallRealtimeRecordingConfig(
        buildRecallRealtimeWebhookUrl(parsedInput.webhookUrl),
      ),
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

export async function createRecallDesktopSdkUpload(input: {
  webhookUrl: string;
  metadata?: Record<string, string>;
}) {
  const parsedInput = recallDesktopSdkUploadInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(buildRecallApiUrl(env, "/api/v1/sdk_upload/"), {
    method: "POST",
    headers: buildRecallJsonHeaders(env),
    body: JSON.stringify({
      recording_config: buildRecallDesktopSdkRealtimeRecordingConfig(
        buildRecallRealtimeWebhookUrl(parsedInput.webhookUrl, {
          desktopSdk: true,
        }),
        parsedInput.metadata,
      ),
      metadata: {
        requested_webhook_url: parsedInput.webhookUrl,
        ...parsedInput.metadata,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Recall Desktop SDK upload creation failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

export async function retrieveRecallRecording(recordingId: string) {
  const env = recallApiEnvSchema.parse(process.env);
  const response = await fetch(
    buildRecallApiUrl(
      env,
      `/api/v1/recording/${encodeURIComponent(recordingId)}/`,
    ),
    {
      method: "GET",
      headers: buildRecallReadHeaders(env),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall recording retrieval failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

function getRecallBotLogoJpegBase64() {
  if (!recallBotLogoJpegBase64) {
    recallBotLogoJpegBase64 = readFileSync(
      join(process.cwd(), "assets", "meeting-bot-logo.jpg"),
    ).toString("base64");
  }

  return recallBotLogoJpegBase64;
}

export async function createRecallCalendar(input: {
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRefreshToken: string;
  platform: "google_calendar" | "microsoft_outlook";
  metadata?: Record<string, string>;
}) {
  const parsedInput = recallCalendarInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(buildRecallApiUrl(env, "/api/v2/calendars/"), {
    method: "POST",
    headers: buildRecallJsonHeaders(env),
    body: JSON.stringify({
      oauth_client_id: parsedInput.oauthClientId,
      oauth_client_secret: parsedInput.oauthClientSecret,
      oauth_refresh_token: parsedInput.oauthRefreshToken,
      platform: parsedInput.platform,
      metadata: parsedInput.metadata,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Recall calendar creation failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

export async function updateRecallCalendar(input: {
  calendarId: string;
  oauthRefreshToken?: string;
  metadata?: Record<string, string>;
}) {
  const parsedInput = recallCalendarUpdateInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(
    buildRecallApiUrl(
      env,
      `/api/v2/calendars/${encodeURIComponent(parsedInput.calendarId)}/`,
    ),
    {
      method: "PATCH",
      headers: buildRecallJsonHeaders(env),
      body: JSON.stringify({
        oauth_refresh_token: parsedInput.oauthRefreshToken,
        metadata: parsedInput.metadata,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall calendar update failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

export async function listRecallCalendars() {
  const env = recallApiEnvSchema.parse(process.env);
  const calendars: unknown[] = [];
  let nextUrl: string | null = buildRecallApiUrl(env, "/api/v2/calendars/");

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: buildRecallReadHeaders(env),
    });

    if (!response.ok) {
      throw new Error(
        `Recall calendar listing failed with ${response.status} ${response.statusText}`,
      );
    }

    const page = (await response.json()) as {
      next?: unknown;
      results?: unknown;
    };

    if (Array.isArray(page.results)) {
      calendars.push(...page.results);
    }

    nextUrl = typeof page.next === "string" && page.next ? page.next : null;
  }

  return calendars;
}

export async function retrieveRecallCalendar(calendarId: string) {
  const env = recallApiEnvSchema.parse(process.env);
  const response = await fetch(
    buildRecallApiUrl(env, `/api/v2/calendars/${encodeURIComponent(calendarId)}/`),
    {
      method: "GET",
      headers: buildRecallReadHeaders(env),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall calendar retrieval failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

export async function listRecallCalendarEvents(input: {
  calendarId: string;
  updatedAtGte?: string;
  startTimeGte?: string;
  isDeleted?: boolean;
}) {
  const parsedInput = recallCalendarEventListInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);
  const initialUrl = new URL(buildRecallApiUrl(env, "/api/v2/calendar-events/"));

  initialUrl.searchParams.set("calendar_id", parsedInput.calendarId);
  if (parsedInput.updatedAtGte) {
    initialUrl.searchParams.set("updated_at__gte", parsedInput.updatedAtGte);
  }
  if (parsedInput.startTimeGte) {
    initialUrl.searchParams.set("start_time__gte", parsedInput.startTimeGte);
  }
  if (parsedInput.isDeleted !== undefined) {
    initialUrl.searchParams.set("is_deleted", String(parsedInput.isDeleted));
  }

  const events: unknown[] = [];
  let nextUrl: string | null = initialUrl.toString();

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: buildRecallReadHeaders(env),
    });

    if (!response.ok) {
      throw new Error(
        `Recall calendar event listing failed with ${response.status} ${response.statusText}`,
      );
    }

    const page = (await response.json()) as {
      next?: unknown;
      results?: unknown;
    };

    if (Array.isArray(page.results)) {
      events.push(...page.results);
    }

    nextUrl = typeof page.next === "string" && page.next ? page.next : null;
  }

  return events;
}

export async function scheduleRecallCalendarEventBot(input: {
  calendarEventId: string;
  deduplicationKey: string;
  botName?: string;
  avatarJpegBase64?: string;
  metadata?: Record<string, string>;
}) {
  const parsedInput = recallCalendarEventBotInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(
    buildRecallApiUrl(
      env,
      `/api/v2/calendar-events/${encodeURIComponent(
        parsedInput.calendarEventId,
      )}/bot/`,
    ),
    {
      method: "POST",
      headers: buildRecallJsonHeaders(env),
      body: JSON.stringify({
        deduplication_key: parsedInput.deduplicationKey,
        bot_config: {
          bot_name: parsedInput.botName,
          automatic_video_output: getRecallBotVideoOutput(
            parsedInput.avatarJpegBase64,
          ),
          recording_config: buildRecallRealtimeRecordingConfig(
            buildRecallRealtimeWebhookUrl(),
          ),
          metadata: parsedInput.metadata,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall calendar bot scheduling failed with ${response.status} ${response.statusText}`,
    );
  }

  return response.json();
}

export async function deleteRecallCalendarEventBot(input: {
  calendarEventId: string;
}) {
  const parsedInput = recallCalendarEventBotDeleteInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(
    buildRecallApiUrl(
      env,
      `/api/v2/calendar-events/${encodeURIComponent(
        parsedInput.calendarEventId,
      )}/bot/`,
    ),
    {
      method: "DELETE",
      headers: buildRecallReadHeaders(env),
    },
  );

  if (response.status === 404) {
    return {};
  }

  if (!response.ok) {
    throw new Error(
      `Recall calendar bot deletion failed with ${response.status} ${response.statusText}`,
    );
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
}

export async function updateScheduledRecallBot(input: {
  botId: string;
  meetingUrl: string;
  botName?: string;
  avatarJpegBase64?: string;
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
        ...(parsedInput.botName ? { bot_name: parsedInput.botName } : {}),
        join_at: parsedInput.startAt,
        automatic_video_output: getRecallBotVideoOutput(
          parsedInput.avatarJpegBase64,
        ),
        recording_config: buildRecallRealtimeRecordingConfig(
          buildRecallRealtimeWebhookUrl(),
        ),
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

  if (response.status === 404) {
    return {};
  }

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

export async function sendRecallChatMessage(input: {
  botId: string;
  message: string;
}) {
  const parsedInput = recallChatMessageInputSchema.parse(input);
  const env = recallApiEnvSchema.parse(process.env);

  const response = await fetch(
    buildRecallApiUrl(
      env,
      `/api/v1/bot/${encodeURIComponent(parsedInput.botId)}/send_chat_message/`,
    ),
    {
      method: "POST",
      headers: buildRecallJsonHeaders(env),
      body: JSON.stringify({ message: parsedInput.message }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall chat message send failed with ${response.status} ${response.statusText}`,
    );
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

export async function listRecallBotScreenshots(botId: string) {
  const env = recallApiEnvSchema.parse(process.env);
  const response = await fetch(
    buildRecallApiUrl(
      env,
      `/api/v1/bot/${encodeURIComponent(botId)}/screenshots/`,
    ),
    {
      method: "GET",
      headers: buildRecallReadHeaders(env),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Recall bot screenshot retrieval failed with ${response.status} ${response.statusText}`,
    );
  }

  return extractRecallBotScreenshots(await response.json());
}

export function extractRecallBotScreenshots(
  payload: unknown,
): RecallBotScreenshot[] {
  const screenshots = getRecallScreenshotRecords(payload);
  const seen = new Set<string>();
  const normalized: RecallBotScreenshot[] = [];

  for (const screenshot of screenshots) {
    if (!screenshot || typeof screenshot !== "object") {
      continue;
    }

    const record = screenshot as Record<string, unknown>;
    const data = getRecord(record.data);
    const downloadUrl =
      getString(data?.download_url) ??
      getString(data?.url) ??
      getString(record.download_url) ??
      getString(record.downloadUrl) ??
      getString(record.image_url) ??
      getString(record.imageUrl) ??
      getString(record.url);

    if (!downloadUrl || seen.has(downloadUrl)) {
      continue;
    }

    seen.add(downloadUrl);
    normalized.push({
      id:
        getString(record.id) ??
        getString(record.uuid) ??
        getString(record.screenshot_id) ??
        getString(record.screenshotId) ??
        downloadUrl,
      capturedAt:
        getString(record.recorded_at) ??
        getString(record.recordedAt) ??
        getString(record.captured_at) ??
        getString(record.capturedAt) ??
        getString(record.timestamp) ??
        null,
      downloadUrl,
    });
  }

  return normalized;
}

function buildRecallApiUrl(
  env: z.infer<typeof recallApiEnvSchema>,
  pathname: string,
) {
  return new URL(pathname, getRecallApiBaseUrl(env)).toString();
}

function buildRecallJsonHeaders(env: z.infer<typeof recallApiEnvSchema>) {
  return {
    ...buildRecallReadHeaders(env),
    "Content-Type": "application/json",
  };
}

function buildRecallReadHeaders(env: z.infer<typeof recallApiEnvSchema>) {
  return {
    Authorization: `Token ${env.RECALL_API_KEY}`,
    Accept: "application/json",
  };
}

export function findRecallRecordingMediaUrl(
  bot: unknown,
  recordingId?: string | null,
) {
  if (!bot || typeof bot !== "object") {
    return null;
  }

  const directUrl = findRecallRecordingMediaUrlInRecord(bot, recordingId);

  if (directUrl) {
    return directUrl;
  }

  const recordings = (bot as { recordings?: unknown }).recordings;

  if (!Array.isArray(recordings)) {
    return null;
  }

  for (const recording of recordings) {
    if (!recording || typeof recording !== "object") {
      continue;
    }

    const url = findRecallRecordingMediaUrlInRecord(recording, recordingId);

    if (url) {
      return url;
    }
  }

  return null;
}

export function findRecallSpeakerTimelineUrl(
  bot: unknown,
  recordingId?: string | null,
) {
  if (!bot || typeof bot !== "object") {
    return null;
  }

  const directUrl = findRecallSpeakerTimelineUrlInRecord(bot, recordingId);

  if (directUrl) {
    return directUrl;
  }

  const recordings = (bot as { recordings?: unknown }).recordings;

  if (!Array.isArray(recordings)) {
    return null;
  }

  for (const recording of recordings) {
    if (!recording || typeof recording !== "object") {
      continue;
    }

    const url = findRecallSpeakerTimelineUrlInRecord(recording, recordingId);

    if (url) {
      return url;
    }
  }

  return null;
}

function findRecallRecordingMediaUrlInRecord(
  recording: unknown,
  recordingId?: string | null,
) {
  if (!recording || typeof recording !== "object") {
    return null;
  }

  const candidate = recording as {
    id?: unknown;
    media_shortcuts?: Record<string, unknown>;
  };

  if (recordingId && candidate.id !== recordingId) {
    return null;
  }

  for (const shortcut of ["audio_mixed", "video_mixed"]) {
    const url = getDownloadUrl(candidate.media_shortcuts?.[shortcut]);

    if (url) {
      return url;
    }
  }

  return null;
}

function findRecallSpeakerTimelineUrlInRecord(
  recording: unknown,
  recordingId?: string | null,
) {
  if (!recording || typeof recording !== "object") {
    return null;
  }

  const candidate = recording as {
    id?: unknown;
    media_shortcuts?: Record<string, unknown>;
    speaker_timeline_download_url?: unknown;
  };

  if (recordingId && candidate.id !== recordingId) {
    return null;
  }

  if (
    typeof candidate.speaker_timeline_download_url === "string" &&
    candidate.speaker_timeline_download_url.trim()
  ) {
    return candidate.speaker_timeline_download_url.trim();
  }

  return (
    getSpeakerTimelineDownloadUrl(candidate.media_shortcuts?.participant_events) ??
    getDownloadUrl(candidate.media_shortcuts?.speaker_timeline)
  );
}

function getSpeakerTimelineDownloadUrl(mediaShortcut: unknown) {
  if (!mediaShortcut || typeof mediaShortcut !== "object") {
    return null;
  }

  const data = (mediaShortcut as { data?: unknown }).data;

  if (!data || typeof data !== "object") {
    return null;
  }

  const downloadUrl = (data as { speaker_timeline_download_url?: unknown })
    .speaker_timeline_download_url;

  return typeof downloadUrl === "string" && downloadUrl.trim()
    ? downloadUrl.trim()
    : null;
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

function getRecallScreenshotRecords(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = getRecord(payload);

  return (
    getArray(record?.results) ??
    getArray(record?.screenshots) ??
    getArray(record?.data) ??
    []
  );
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : null;
}

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
