import { describe, expect, it } from "vitest";

import {
  comparisonTotalUsdMicros,
  computeMonthlyCost,
  personMeetingHours,
  recordedMeetingHours,
  WORKING_DAYS_PER_MONTH,
} from "@/lib/pricing-calculator";

describe("personMeetingHours", () => {
  it("multiplies team size, hours per day, and working days", () => {
    expect(personMeetingHours(10, 1.5)).toBeCloseTo(
      10 * 1.5 * WORKING_DAYS_PER_MONTH,
    );
  });

  it("returns 0 for non-positive input", () => {
    expect(personMeetingHours(0, 1.5)).toBe(0);
    expect(personMeetingHours(10, 0)).toBe(0);
    expect(personMeetingHours(-3, 1.5)).toBe(0);
  });
});

describe("recordedMeetingHours", () => {
  it("divides person hours by average attendees per meeting", () => {
    const person = personMeetingHours(12, 2);
    expect(recordedMeetingHours(12, 2, 3)).toBeCloseTo(person / 3);
  });

  it("equals person hours when meetings are one-on-none (1 attendee)", () => {
    const person = personMeetingHours(8, 1.5);
    expect(recordedMeetingHours(8, 1.5, 1)).toBeCloseTo(person);
  });

  it("never divides by more than the team size", () => {
    const person = personMeetingHours(4, 1);
    // 10 attendees requested but only 4 people exist.
    expect(recordedMeetingHours(4, 1, 10)).toBeCloseTo(person / 4);
  });

  it("treats attendees below 1 as 1", () => {
    const person = personMeetingHours(5, 1);
    expect(recordedMeetingHours(5, 1, 0)).toBeCloseTo(person);
  });
});

describe("computeMonthlyCost", () => {
  const base = {
    teamSize: 10,
    meetingHoursPerPersonPerDay: 1.5,
    avgAttendeesPerMeeting: 3,
  };

  it("sums all cost categories into the total", () => {
    const breakdown = computeMonthlyCost({
      ...base,
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

  it("bills recording and transcription on recorded, not person, hours", () => {
    const solo = computeMonthlyCost({
      teamSize: 6,
      meetingHoursPerPersonPerDay: 1,
      avgAttendeesPerMeeting: 1, // every meeting distinct
      recordingProviderId: "recall",
      sttProviderId: "aws-transcribe",
      databaseProviderId: "supabase",
    });
    const shared = computeMonthlyCost({
      teamSize: 6,
      meetingHoursPerPersonPerDay: 1,
      avgAttendeesPerMeeting: 3, // three teammates per call
      recordingProviderId: "recall",
      sttProviderId: "aws-transcribe",
      databaseProviderId: "supabase",
    });

    // Three-per-meeting collapses to a third of the recorded hours and cost.
    expect(shared.recordedMeetingHoursPerMonth).toBeCloseTo(
      solo.recordedMeetingHoursPerMonth / 3,
    );
    expect(shared.recordingUsdMicros).toBe(
      Math.round(solo.recordingUsdMicros / 3),
    );
    expect(shared.sttUsdMicros).toBe(Math.round(solo.sttUsdMicros / 3));
    // Person hours are unchanged; only recorded hours shrink.
    expect(shared.personMeetingHoursPerMonth).toBe(
      solo.personMeetingHoursPerMonth,
    );
  });

  it("divides the total by team size for the per-person figure", () => {
    const breakdown = computeMonthlyCost({
      ...base,
      recordingProviderId: "attendee",
      sttProviderId: "fish-audio",
      databaseProviderId: "neon",
    });

    expect(breakdown.perPersonUsdMicros).toBe(
      Math.round(breakdown.totalUsdMicros / 10),
    );
  });

  it("uses known per-hour rates on recorded hours", () => {
    const breakdown = computeMonthlyCost({
      teamSize: 1,
      meetingHoursPerPersonPerDay: 1,
      avgAttendeesPerMeeting: 1,
      recordingProviderId: "recall", // $0.50/hr
      sttProviderId: "elevenlabs", // $0.22/hr
      databaseProviderId: "neon",
    });

    const hours = WORKING_DAYS_PER_MONTH; // 1 person, 1 hr/day, 1 attendee
    expect(breakdown.recordingUsdMicros).toBe(Math.round(hours * 500_000));
    expect(breakdown.sttUsdMicros).toBe(Math.round(hours * 220_000));
  });

  it("falls back to defaults for unknown provider ids", () => {
    const breakdown = computeMonthlyCost({
      ...base,
      recordingProviderId: "nope",
      // @ts-expect-error intentional unknown id
      sttProviderId: "nope",
      // @ts-expect-error intentional unknown id
      databaseProviderId: "nope",
    });

    const fallback = computeMonthlyCost({
      ...base,
      // Unknown ids fall back to the first entry of each provider list.
      recordingProviderId: "attendee",
      sttProviderId: "elevenlabs",
      databaseProviderId: "neon",
    });

    expect(breakdown.totalUsdMicros).toBe(fallback.totalUsdMicros);
  });

  it("counts the self-host box once when capture and STT share it", () => {
    const shared = computeMonthlyCost({
      ...base,
      recordingProviderId: "attendee", // self-host
      sttProviderId: "whisper", // self-host
      databaseProviderId: "neon",
    });
    const paidStt = computeMonthlyCost({
      ...base,
      recordingProviderId: "attendee", // self-host
      sttProviderId: "elevenlabs", // paid per-hour
      databaseProviderId: "neon",
    });

    // Box cost is identical whether one or both self-host services use it.
    expect(shared.hostingUsdMicros).toBe(paidStt.hostingUsdMicros);
    // Self-host capture + transcription carry no per-hour charge.
    expect(shared.recordingUsdMicros).toBe(0);
    expect(shared.sttUsdMicros).toBe(0);
    expect(shared.hostingUsdMicros).toBe(15_000_000); // $5 + $10
  });

  it("charges per-hour rates for managed capture even when STT self-hosts", () => {
    const breakdown = computeMonthlyCost({
      teamSize: 1,
      meetingHoursPerPersonPerDay: 1,
      avgAttendeesPerMeeting: 1,
      recordingProviderId: "recall", // $0.50/hr managed
      sttProviderId: "whisper",
      databaseProviderId: "neon",
    });

    const hours = WORKING_DAYS_PER_MONTH;
    expect(breakdown.recordingUsdMicros).toBe(Math.round(hours * 500_000));
    expect(breakdown.sttUsdMicros).toBe(0);
    expect(breakdown.hostingUsdMicros).toBe(15_000_000); // box still needed for Whisper
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
