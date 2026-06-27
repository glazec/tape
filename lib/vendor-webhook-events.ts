import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { vendorWebhookEvents } from "@/db/schema";

type Provider = "elevenlabs" | "recall";

type RecordVendorWebhookEventInput = {
  provider: Provider;
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
};

export class MissingWebhookIdempotencyKeyError extends Error {
  constructor(provider: Provider) {
    super(`Missing ${provider} webhook idempotency key`);
    this.name = "MissingWebhookIdempotencyKeyError";
  }
}

export async function recordVendorWebhookEvent(
  input: RecordVendorWebhookEventInput,
) {
  if (!input.idempotencyKey) {
    throw new MissingWebhookIdempotencyKeyError(input.provider);
  }

  const rows = await db
    .insert(vendorWebhookEvents)
    .values({
      provider: input.provider,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      processedAt: null,
    })
    .onConflictDoNothing({
      target: [
        vendorWebhookEvents.provider,
        vendorWebhookEvents.idempotencyKey,
      ],
    })
    .returning({
      id: vendorWebhookEvents.id,
      processedAt: vendorWebhookEvents.processedAt,
    });

  if (rows[0]) {
    return {
      id: rows[0].id,
      inserted: true,
      processed: false,
      shouldProcess: true,
    };
  }

  const [existing] = await db
    .select({
      id: vendorWebhookEvents.id,
      processedAt: vendorWebhookEvents.processedAt,
    })
    .from(vendorWebhookEvents)
    .where(
      and(
        eq(vendorWebhookEvents.provider, input.provider),
        eq(vendorWebhookEvents.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  const processed = Boolean(existing?.processedAt);

  return {
    id: existing?.id ?? null,
    inserted: false,
    processed,
    shouldProcess: !processed && Boolean(existing),
  };
}

export async function markVendorWebhookEventProcessed(input: {
  provider: Provider;
  idempotencyKey: string;
}) {
  if (!input.idempotencyKey) {
    throw new MissingWebhookIdempotencyKeyError(input.provider);
  }

  await db
    .update(vendorWebhookEvents)
    .set({
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(vendorWebhookEvents.provider, input.provider),
        eq(vendorWebhookEvents.idempotencyKey, input.idempotencyKey),
      ),
    );
}
