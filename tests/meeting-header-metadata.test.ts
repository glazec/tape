import { describe, expect, it } from "vitest";

import {
  formatMeetingHeaderDateTime,
  formatMeetingHeaderDuration,
} from "@/components/meeting-header-metadata";

describe("meeting header metadata", () => {
  it("uses a compact relative date for meetings today", () => {
    expect(
      formatMeetingHeaderDateTime(
        "2026-07-18T10:00:00",
        new Date("2026-07-18T18:00:00"),
      ),
    ).toBe("Today, 10:00 AM");
  });

  it("shows a natural minute duration", () => {
    expect(
      formatMeetingHeaderDuration({
        durationMs: 42 * 60_000,
        endedAt: null,
        startedAt: "2026-07-18T10:00:00-04:00",
      }),
    ).toBe("42 minutes");
  });

  it("shows completed minutes for the recovered 42 minute meeting", () => {
    expect(
      formatMeetingHeaderDuration({
        durationMs: 2_571_358,
        endedAt: "2026-07-22T18:04:18.857Z",
        startedAt: "2026-07-22T17:21:27.499Z",
      }),
    ).toBe("42 minutes");
  });

  it("prefers recorded duration over the scheduled calendar interval", () => {
    expect(
      formatMeetingHeaderDuration({
        durationMs: 45 * 60_000,
        endedAt: "2026-07-18T11:05:00-04:00",
        startedAt: "2026-07-18T10:35:00-04:00",
      }),
    ).toBe("45 minutes");
  });

  it("shows planned duration only for an upcoming scheduled meeting", () => {
    expect(
      formatMeetingHeaderDuration({
        durationMs: null,
        endedAt: "2026-07-18T10:30:00-04:00",
        now: new Date("2026-07-18T09:00:00-04:00"),
        startedAt: "2026-07-18T10:00:00-04:00",
        status: "Scheduled",
      }),
    ).toBe("30 minutes");
    expect(
      formatMeetingHeaderDuration({
        durationMs: null,
        endedAt: "2026-07-18T10:30:00-04:00",
        now: new Date("2026-07-18T11:00:00-04:00"),
        startedAt: "2026-07-18T10:00:00-04:00",
        status: "No recording",
      }),
    ).toBeNull();
  });
});
