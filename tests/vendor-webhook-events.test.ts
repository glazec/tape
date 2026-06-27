import { afterEach, describe, expect, it, vi } from "vitest";

const { insert, select, update } = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert,
    select,
    update,
  },
}));

describe("vendor webhook idempotency", () => {
  afterEach(() => {
    insert.mockReset();
    select.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("records a new webhook as unprocessed until side effects complete", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        processedAt: null,
      },
    ]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });

    insert.mockReturnValue({ values });

    const { recordVendorWebhookEvent } = await import(
      "@/lib/vendor-webhook-events"
    );

    await expect(
      recordVendorWebhookEvent({
        provider: "recall",
        eventType: "calendar.sync_events",
        idempotencyKey: "msg_calendar_sync",
        payload: { event: "calendar.sync_events" },
      }),
    ).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      inserted: true,
      processed: false,
      shouldProcess: true,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "msg_calendar_sync",
        processedAt: null,
      }),
    );
  });

  it("allows a duplicate webhook retry when the stored row is not processed", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });

    insert.mockReturnValue({ values });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "11111111-1111-4111-8111-111111111111",
              processedAt: null,
            },
          ]),
        }),
      }),
    });

    const { recordVendorWebhookEvent } = await import(
      "@/lib/vendor-webhook-events"
    );

    await expect(
      recordVendorWebhookEvent({
        provider: "recall",
        eventType: "calendar.sync_events",
        idempotencyKey: "msg_calendar_sync",
        payload: { event: "calendar.sync_events" },
      }),
    ).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      inserted: false,
      processed: false,
      shouldProcess: true,
    });
  });

  it("skips a duplicate webhook when the stored row is already processed", async () => {
    const processedAt = new Date("2026-06-30T12:00:00.000Z");
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });

    insert.mockReturnValue({ values });
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              id: "11111111-1111-4111-8111-111111111111",
              processedAt,
            },
          ]),
        }),
      }),
    });

    const { recordVendorWebhookEvent } = await import(
      "@/lib/vendor-webhook-events"
    );

    await expect(
      recordVendorWebhookEvent({
        provider: "recall",
        eventType: "calendar.sync_events",
        idempotencyKey: "msg_calendar_sync",
        payload: { event: "calendar.sync_events" },
      }),
    ).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      inserted: false,
      processed: true,
      shouldProcess: false,
    });
  });

  it("marks a webhook processed after side effects finish", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });

    update.mockReturnValue({ set });

    const { markVendorWebhookEventProcessed } = await import(
      "@/lib/vendor-webhook-events"
    );

    await markVendorWebhookEventProcessed({
      provider: "recall",
      idempotencyKey: "msg_calendar_sync",
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        processedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
  });
});
