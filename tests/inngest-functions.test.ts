import { afterEach, describe, expect, it, vi } from "vitest";

const {
  autoJoinCalendarEvent,
  createElevenLabsTranscriptJob,
  createReadUrl,
  scheduleRecallBot,
  update,
} = vi.hoisted(() => ({
    autoJoinCalendarEvent: vi.fn(),
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

vi.mock("@/lib/calendar-auto-join", () => ({
  autoJoinCalendarEvent,
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

  it("registers calendar event auto join", async () => {
    const { functions } = await import("@/inngest/functions");

    expect(
      functions.map((fn) => ({
        id: fn.opts.id,
        triggers: fn.opts.triggers,
      })),
    ).toContainEqual({
      id: "auto-join-calendar-event",
      triggers: [{ event: "calendar/event.synced" }],
    });
  });
});
