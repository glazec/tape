import { afterEach, describe, expect, it, vi } from "vitest";

const { select, sendOneSignalLocationReminder, update } = vi.hoisted(() => ({
  select: vi.fn(),
  sendOneSignalLocationReminder: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select, update },
}));

vi.mock("@/lib/vendors/onesignal", () => ({
  sendOneSignalLocationReminder,
}));

describe("location reminders", () => {
  afterEach(() => {
    select.mockReset();
    sendOneSignalLocationReminder.mockReset();
    update.mockReset();
    vi.resetModules();
  });

  it("sends due location reminders through OneSignal", async () => {
    select.mockReturnValue({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            innerJoin: () => ({
              where: () => ({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: "reminder_123",
                    meetingId: "22222222-2222-4222-8222-222222222222",
                    userId: "11111111-1111-4111-8111-111111111111",
                    title: "Founder office visit",
                    location: "IOSG 12F",
                  },
                ]),
              }),
            }),
          }),
        }),
      }),
    });
    update.mockReturnValue({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    sendOneSignalLocationReminder.mockResolvedValue({
      id: "notification_123",
    });

    const { sendDueLocationReminders } = await import(
      "@/lib/location-reminders"
    );

    await expect(
      sendDueLocationReminders({
        now: new Date("2026-06-30T11:58:00.000Z"),
      }),
    ).resolves.toEqual({ sentCount: 1 });

    expect(sendOneSignalLocationReminder).toHaveBeenCalledWith({
      externalUserId: "11111111-1111-4111-8111-111111111111",
      location: "IOSG 12F",
      meetingId: "22222222-2222-4222-8222-222222222222",
      meetingTitle: "Founder office visit",
    });
  });
});
