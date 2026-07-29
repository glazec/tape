import { describe, expect, it } from "vitest";

import {
  comparisonTotalUsdMicros,
  computeMonthlyCost,
  monthlyMeetingHours,
  WORKING_DAYS_PER_MONTH,
} from "@/lib/pricing-calculator";

describe("monthlyMeetingHours", () => {
  it("multiplies team size, hours per day, and working days", () => {
    expect(monthlyMeetingHours(10, 1.5)).toBeCloseTo(
      10 * 1.5 * WORKING_DAYS_PER_MONTH,
    );
  });

  it("returns 0 for non-positive input", () => {
    expect(monthlyMeetingHours(0, 1.5)).toBe(0);
    expect(monthlyMeetingHours(10, 0)).toBe(0);
    expect(monthlyMeetingHours(-3, 1.5)).toBe(0);
  });
});

describe("computeMonthlyCost", () => {
  it("sums all cost categories into the total", () => {
    const breakdown = computeMonthlyCost({
      teamSize: 10,
      meetingHoursPerPersonPerDay: 1.5,
      recordingProviderId: "attendee",
      sttProviderId: "elevenlabs",
      databaseProviderId: "neon",
    });

    expect(breakdown.totalUsdMicros).toBe(
      breakdown.recordingUsdMicros +
        breakdown.sttUsdMicros +
        breakdown.llmUsdMicros +
        breakdown.databaseUsdMicros +
        breakdown.hostingUsdMicros,
    );
  });

  it("scales recording and transcription with meeting hours", () => {
    const one = computeMonthlyCost({
      teamSize: 1,
      meetingHoursPerPersonPerDay: 1,
      recordingProviderId: "recall",
      sttProviderId: "aws-transcribe",
      databaseProviderId: "supabase",
    });
    const two = computeMonthlyCost({
      teamSize: 2,
      meetingHoursPerPersonPerDay: 1,
      recordingProviderId: "recall",
      sttProviderId: "aws-transcribe",
      databaseProviderId: "supabase",
    });

    expect(two.recordingUsdMicros).toBe(one.recordingUsdMicros * 2);
    expect(two.sttUsdMicros).toBe(one.sttUsdMicros * 2);
    // Database and hosting stay flat regardless of meeting hours.
    expect(two.databaseUsdMicros).toBe(one.databaseUsdMicros);
    expect(two.hostingUsdMicros).toBe(one.hostingUsdMicros);
  });

  it("divides the total by team size for the per-person figure", () => {
    const breakdown = computeMonthlyCost({
      teamSize: 10,
      meetingHoursPerPersonPerDay: 1.5,
      recordingProviderId: "attendee",
      sttProviderId: "fish-audio",
      databaseProviderId: "neon",
    });

    expect(breakdown.perPersonUsdMicros).toBe(
      Math.round(breakdown.totalUsdMicros / 10),
    );
  });

  it("uses known per-hour rates for recording and STT providers", () => {
    const breakdown = computeMonthlyCost({
      teamSize: 1,
      meetingHoursPerPersonPerDay: 1,
      recordingProviderId: "recall", // $0.50/hr
      sttProviderId: "elevenlabs", // $0.22/hr
      databaseProviderId: "neon",
    });

    const hours = 1 * 1 * WORKING_DAYS_PER_MONTH;
    expect(breakdown.recordingUsdMicros).toBe(
      Math.round(hours * 500_000),
    );
    expect(breakdown.sttUsdMicros).toBe(Math.round(hours * 220_000));
  });

  it("falls back to defaults for unknown provider ids", () => {
    const breakdown = computeMonthlyCost({
      teamSize: 5,
      meetingHoursPerPersonPerDay: 2,
      // @ts-expect-error intentional unknown id
      recordingProviderId: "nope",
      // @ts-expect-error intentional unknown id
      sttProviderId: "nope",
      // @ts-expect-error intentional unknown id
      databaseProviderId: "nope",
    });

    const fallback = computeMonthlyCost({
      teamSize: 5,
      meetingHoursPerPersonPerDay: 2,
      recordingProviderId: "attendee",
      sttProviderId: "elevenlabs",
      databaseProviderId: "neon",
    });

    expect(breakdown.totalUsdMicros).toBe(fallback.totalUsdMicros);
  });
});

describe("comparisonTotalUsdMicros", () => {
  it("multiplies per-seat price by team size", () => {
    expect(comparisonTotalUsdMicros(10_000_000, 12)).toBe(120_000_000);
  });

  it("returns 0 for empty teams", () => {
    expect(comparisonTotalUsdMicros(10_000_000, 0)).toBe(0);
  });
});
