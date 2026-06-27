import { afterEach, describe, expect, it, vi } from "vitest";

const { createElevenLabsTranscriptJob, createReadUrl, scheduleRecallBot, update } =
  vi.hoisted(() => ({
    createElevenLabsTranscriptJob: vi.fn(),
    createReadUrl: vi.fn(),
    scheduleRecallBot: vi.fn(),
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

describe("Inngest functions", () => {
  afterEach(() => {
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
    ]);
  });
});
