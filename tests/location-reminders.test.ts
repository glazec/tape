import { afterEach, describe, expect, it, vi } from "vitest";

const { inngestSend, insert, select, sendOneSignalLocationReminder, update } =
  vi.hoisted(() => ({
    inngestSend: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
    sendOneSignalLocationReminder: vi.fn(),
    update: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db: { insert, select, update },
}));

vi.mock("@/inngest/client", () => ({
  inngest: { send: inngestSend },
}));

vi.mock("@/lib/vendors/onesignal", () => ({
  sendOneSignalLocationReminder,
}));

describe("location reminders", () => {
  afterEach(() => {
    inngestSend.mockReset();
    insert.mockReset();
    select.mockReset();
    sendOneSignalLocationReminder.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("versions and dispatches a durable reminder schedule", async () => {
    const scheduledFor = new Date("2026-06-30T11:58:00.000Z");
    const reminder = {
      deliveryIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      dispatchedVersion: 0,
      id: "33333333-3333-4333-8333-333333333333",
      scheduleVersion: 2,
      scheduledFor,
      sentAt: null,
      status: "pending",
    };
    const returning = vi.fn().mockResolvedValue([reminder]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    insert.mockReturnValue({ values });
    inngestSend.mockResolvedValue({ ids: ["event_123"] });
    const dispatchWhere = vi.fn().mockResolvedValue(undefined);
    const dispatchSet = vi.fn().mockReturnValue({ where: dispatchWhere });
    update.mockReturnValue({ set: dispatchSet });

    const { scheduleLocationReminder } = await import(
      "@/lib/location-reminders"
    );

    await expect(
      scheduleLocationReminder({
        meetingId: "11111111-1111-4111-8111-111111111111",
        scheduledFor,
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toEqual(reminder);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryIdempotencyKey: expect.any(String),
        meetingId: "11111111-1111-4111-8111-111111111111",
        scheduledFor,
        status: "pending",
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          deliveryIdempotencyKey: expect.any(String),
          scheduleVersion: expect.anything(),
          scheduledFor,
          status: "pending",
        }),
      }),
    );
    expect(inngestSend).toHaveBeenCalledWith({
      id: "location-reminder:33333333-3333-4333-8333-333333333333:2",
      name: "meeting/send.location-reminder",
      data: {
        reminderId: "33333333-3333-4333-8333-333333333333",
        scheduleVersion: 2,
        scheduledFor: "2026-06-30T11:58:00.000Z",
      },
    });
    expect(dispatchSet).toHaveBeenCalledWith(
      expect.objectContaining({ dispatchedVersion: 2 }),
    );
  });

  it("does not schedule an unchanged reminder that was already sent", async () => {
    const scheduledFor = new Date("2026-06-30T11:58:00.000Z");
    const sentReminder = {
      deliveryIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      dispatchedVersion: 3,
      id: "33333333-3333-4333-8333-333333333333",
      scheduleVersion: 3,
      scheduledFor,
      sentAt: scheduledFor,
      status: "sent",
    };
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    insert.mockReturnValue({ values });
    mockScheduleSelection([sentReminder]);

    const { scheduleLocationReminder } = await import(
      "@/lib/location-reminders"
    );

    await expect(
      scheduleLocationReminder({
        meetingId: "11111111-1111-4111-8111-111111111111",
        scheduledFor,
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toEqual(sentReminder);
    expect(inngestSend).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("sends the current schedule with a stable OneSignal idempotency key", async () => {
    const now = new Date("2026-06-30T11:58:00.000Z");
    mockReminderSelection([currentReminder]);
    const claimReturning = vi
      .fn()
      .mockResolvedValue([{ id: currentReminder.id }]);
    const claimWhere = vi.fn().mockReturnValue({ returning: claimReturning });
    const claimSet = vi.fn().mockReturnValue({ where: claimWhere });
    const sentWhere = vi.fn().mockResolvedValue(undefined);
    const sentSet = vi.fn().mockReturnValue({ where: sentWhere });
    update
      .mockReturnValueOnce({ set: claimSet })
      .mockReturnValueOnce({ set: sentSet });
    sendOneSignalLocationReminder.mockResolvedValue({
      id: "notification_123",
    });

    const { sendScheduledLocationReminder } = await import(
      "@/lib/location-reminders"
    );

    await expect(
      sendScheduledLocationReminder(
        {
          reminderId: currentReminder.id,
          scheduleVersion: 3,
          scheduledFor: "2026-06-30T11:58:00.000Z",
        },
        { now },
      ),
    ).resolves.toEqual({ action: "sent" });

    expect(sendOneSignalLocationReminder).toHaveBeenCalledWith({
      idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      externalUserId: "22222222-2222-4222-8222-222222222222",
      location: "IOSG 12F",
      meetingId: "11111111-1111-4111-8111-111111111111",
      meetingTitle: "Founder office visit",
    });
    expect(sentSet).toHaveBeenCalledWith({
      providerNotificationId: "notification_123",
      sentAt: now,
      status: "sent",
      updatedAt: now,
    });
  });

  it("does not send an obsolete schedule version", async () => {
    mockReminderSelection([]);

    const { sendScheduledLocationReminder } = await import(
      "@/lib/location-reminders"
    );

    await expect(
      sendScheduledLocationReminder({
        reminderId: currentReminder.id,
        scheduleVersion: 2,
        scheduledFor: "2026-06-30T11:58:00.000Z",
      }),
    ).resolves.toEqual({
      action: "skipped",
      reason: "stale_schedule",
    });
    expect(sendOneSignalLocationReminder).not.toHaveBeenCalled();
  });

  it("returns a failed delivery to pending and lets Inngest retry", async () => {
    const now = new Date("2026-06-30T11:58:00.000Z");
    mockReminderSelection([currentReminder]);
    const claimReturning = vi
      .fn()
      .mockResolvedValue([{ id: currentReminder.id }]);
    const claimWhere = vi.fn().mockReturnValue({ returning: claimReturning });
    const claimSet = vi.fn().mockReturnValue({ where: claimWhere });
    const retryWhere = vi.fn().mockResolvedValue(undefined);
    const retrySet = vi.fn().mockReturnValue({ where: retryWhere });
    update
      .mockReturnValueOnce({ set: claimSet })
      .mockReturnValueOnce({ set: retrySet });
    sendOneSignalLocationReminder.mockRejectedValue(
      new Error("OneSignal notification failed with 503 Unavailable"),
    );

    const { sendScheduledLocationReminder } = await import(
      "@/lib/location-reminders"
    );

    await expect(
      sendScheduledLocationReminder(
        {
          reminderId: currentReminder.id,
          scheduleVersion: 3,
          scheduledFor: "2026-06-30T11:58:00.000Z",
        },
        { now },
      ),
    ).rejects.toThrow("503 Unavailable");
    expect(retrySet).toHaveBeenCalledWith({
      errorMessage: "OneSignal notification failed with 503 Unavailable",
      status: "pending",
      updatedAt: now,
    });
  });
});

const currentReminder = {
  deliveryIdempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  id: "33333333-3333-4333-8333-333333333333",
  location: "IOSG 12F",
  meetingId: "11111111-1111-4111-8111-111111111111",
  meetingStatus: "scheduled",
  platform: "in_person",
  scheduleVersion: 3,
  scheduledFor: new Date("2026-06-30T11:58:00.000Z"),
  sentAt: null,
  startsAt: new Date("2026-06-30T12:00:00.000Z"),
  status: "pending",
  title: "Founder office visit",
  userId: "22222222-2222-4222-8222-222222222222",
};

function mockReminderSelection(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const secondInnerJoin = vi.fn().mockReturnValue({ where });
  const firstInnerJoin = vi.fn().mockReturnValue({
    innerJoin: secondInnerJoin,
  });
  const from = vi.fn().mockReturnValue({ innerJoin: firstInnerJoin });

  select.mockReturnValue({ from });
}

function mockScheduleSelection(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });

  select.mockReturnValue({ from });
}
