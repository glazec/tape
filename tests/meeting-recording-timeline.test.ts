import { describe, expect, it } from "vitest";

import {
  getRecordingPartEndOffsetMs,
  getRecordingPartOffsetMs,
} from "@/lib/meeting-recording-timeline";

const parts = [
  {
    durationMs: 420_000,
    startedAt: "2026-07-22T17:00:00.000Z",
  },
  {
    durationMs: 900_000,
    startedAt: "2026-07-22T17:20:00.000Z",
  },
];

describe("meeting recording timeline", () => {
  it("maps resumed parts onto the original meeting timeline", () => {
    expect(getRecordingPartOffsetMs(parts, 0)).toBe(0);
    expect(getRecordingPartEndOffsetMs(parts, 0)).toBe(1_200_000);
    expect(getRecordingPartOffsetMs(parts, 1)).toBe(1_200_000);
    expect(getRecordingPartEndOffsetMs(parts, 1)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("falls back to prior durations when recording start times are absent", () => {
    const undatedParts = [
      { durationMs: 420_000, startedAt: null },
      { durationMs: 900_000, startedAt: null },
    ];

    expect(getRecordingPartOffsetMs(undatedParts, 1)).toBe(420_000);
  });
});
