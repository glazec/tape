import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export class WebhookVerificationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 500,
  ) {
    super(message);
  }
}

const RECALL_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const RECALL_DESKTOP_REALTIME_TOKEN_CONTEXT =
  "meeting-note:recall-desktop-realtime:v1";

export async function verifyElevenLabsWebhook(
  rawBody: string,
  headers: Headers,
) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim();
  const signature = headers.get("elevenlabs-signature");

  if (!secret) {
    throw new WebhookVerificationError("Webhook secret is not configured", 500);
  }

  if (!signature) {
    throw new WebhookVerificationError("Invalid webhook signature", 401);
  }

  try {
    const elevenLabsClient = new ElevenLabsClient();

    return await elevenLabsClient.webhooks.constructEvent(
      rawBody,
      signature,
      secret,
    );
  } catch {
    throw new WebhookVerificationError("Invalid webhook signature", 401);
  }
}

export function verifyRecallWebhook(rawBody: string, headers: Headers) {
  const key = getRecallWebhookKey();

  const messageId = headers.get("webhook-id") ?? headers.get("svix-id");
  const timestamp =
    headers.get("webhook-timestamp") ?? headers.get("svix-timestamp");
  const signature =
    headers.get("webhook-signature") ?? headers.get("svix-signature");

  if (!messageId || !timestamp || !signature) {
    throw new WebhookVerificationError("Invalid webhook signature", 401);
  }

  const timestampSeconds = Number(timestamp);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) >
      RECALL_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    throw new WebhookVerificationError("Invalid webhook signature", 401);
  }

  const expectedSignature = createHmac("sha256", key)
    .update(`${messageId}.${timestamp}.${rawBody}`)
    .digest("base64");
  const expectedBytes = Buffer.from(expectedSignature, "base64");

  for (const versionedSignature of signature.split(" ")) {
    const [version, value] = versionedSignature.split(",");
    if (version !== "v1" || !value) {
      continue;
    }

    const valueBytes = Buffer.from(value, "base64");
    if (
      valueBytes.length === expectedBytes.length &&
      timingSafeEqual(valueBytes, expectedBytes)
    ) {
      return;
    }
  }

  throw new WebhookVerificationError("Invalid webhook signature", 401);
}

export function createRecallDesktopRealtimeWebhookToken() {
  return createHmac("sha256", getRecallWebhookKey())
    .update(RECALL_DESKTOP_REALTIME_TOKEN_CONTEXT)
    .digest("base64url");
}

export function verifyRecallRealtimeWebhook(
  rawBody: string,
  request: Request,
) {
  try {
    verifyRecallWebhook(rawBody, request.headers);

    return (
      request.headers.get("webhook-id") ?? request.headers.get("svix-id") ?? ""
    );
  } catch (signatureError) {
    const providedToken = new URL(request.url).searchParams.get("token") ?? "";
    const expectedToken = createRecallDesktopRealtimeWebhookToken();
    const providedBytes = Buffer.from(providedToken);
    const expectedBytes = Buffer.from(expectedToken);

    if (
      providedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(providedBytes, expectedBytes)
    ) {
      throw signatureError;
    }

    return `dsdk:${createHash("sha256").update(rawBody).digest("base64url")}`;
  }
}

function getRecallWebhookKey() {
  const secret = process.env.RECALL_WEBHOOK_SECRET?.trim();

  if (!secret || !secret.startsWith("whsec_")) {
    throw new WebhookVerificationError("Webhook secret is not configured", 500);
  }

  const key = Buffer.from(secret.slice("whsec_".length), "base64");

  if (key.length === 0) {
    throw new WebhookVerificationError("Webhook secret is not configured", 500);
  }

  return key;
}

export function webhookVerificationResponse(error: unknown) {
  if (error instanceof WebhookVerificationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json(
    { error: "Webhook verification failed" },
    { status: 500 },
  );
}
