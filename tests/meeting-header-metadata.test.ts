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

  it("prefers the recorded start and end interval", () => {
    expect(
      formatMeetingHeaderDuration({
        durationMs: 10 * 60_000,
        endedAt: "2026-07-18T11:05:00-04:00",
        startedAt: "2026-07-18T10:00:00-04:00",
      }),
    ).toBe("1h 5m");
  });
});
