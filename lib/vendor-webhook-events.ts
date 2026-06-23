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
      processedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [
        vendorWebhookEvents.provider,
        vendorWebhookEvents.idempotencyKey,
      ],
    })
    .returning({ id: vendorWebhookEvents.id });

  return { inserted: rows.length > 0 };
}
