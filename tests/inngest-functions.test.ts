import { afterEach, describe, expect, it, vi } from "vitest";

const {
  createElevenLabsTranscriptJob,
  createReadUrl,
  scheduleRecallBot,
  syncRecallCalendarEventsForAllConnectedUsers,
  update,
} =
  vi.hoisted(() => ({
    createElevenLabsTranscriptJob: vi.fn(),
    createReadUrl: vi.fn(),
    scheduleRecallBot: vi.fn(),
    syncRecallCalendarEventsForAllConnectedUsers: vi.fn(),
    update: vi.fn(),
  }));

vi.mock("@/db/client", () => ({
  db: {
    update,
  },
}));

vi.mock("@/lib/r2", () => ({
  createReadUrl,
}));

vi.mock("@/lib/vendors/elevenlabs", () => ({
  createElevenLabsTranscriptJob,
}));

vi.mock("@/lib/vendors/recall", () => ({
  scheduleRecallBot,
}));

vi.mock("@/lib/recall-calendar-bulk-sync", () => ({
  syncRecallCalendarEventsForAllConnectedUsers,
}));

type RunnableInngestFunction = {
  fn: () => Promise<unknown>;
};

describe("Inngest functions", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("registers non-calendar background workers", async () => {
    const { functions } = await import("@/inngest/functions");

    expect(
      functions.map((fn) => ({
        id: fn.opts.id,
        triggers: fn.opts.triggers,
      })),
    ).toEqual([
      {
        id: "schedule-meeting-bot",
        triggers: [{ event: "meeting/schedule.bot" }],
      },
      {
        id: "transcribe-audio",
        triggers: [{ event: "meeting/transcribe.audio" }],
      },
      {
        id: "enrich-transcript",
        triggers: [{ event: "meeting/enrich.transcript" }],
      },
      {
        id: "send-location-reminders",
        triggers: [{ event: "meeting/send.location-reminders" }],
      },
      {
        id: "sync-recall-calendars-hourly",
        triggers: [{ cron: "0 * * * *" }],
      },
    ]);
  });

  it("runs the hourly Recall Calendar repair sync", async () => {
    const syncResult = {
      connectionCount: 2,
      failedConnectionCount: 0,
      failures: [],
      syncedConnectionCount: 2,
      syncedEventCount: 7,
    };
    syncRecallCalendarEventsForAllConnectedUsers.mockResolvedValue(syncResult);

    const { syncRecallCalendarsHourly } = await import("@/inngest/functions");

    await expect(
      (syncRecallCalendarsHourly as unknown as RunnableInngestFunction).fn(),
    ).resolves.toEqual(syncResult);
    expect(syncRecallCalendarEventsForAllConnectedUsers).toHaveBeenCalledTimes(1);
  });
});
