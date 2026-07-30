import { describe, expect, it } from "vitest";

import {
  buildCalendarEstimatePayload,
  CALENDAR_LOOKBACK_DAYS,
  DAYS_PER_MONTH,
  summarizeConnectedCalendar,
} from "@/lib/pricing-calendar-estimate";
import { computeCostFromHours } from "@/lib/pricing-calculator";

function event(input: {
  startIso: string;
  endIso: string;
  attendees: readonly {
    email: string;
    displayName?: string;
    resource?: boolean;
    responseStatus?: string;
    self?: boolean;
  }[];
  status?: string;
  eventType?: string;
  organizer?: { email: string; self?: boolean };
}) {
  return {
    status: input.status ?? "confirmed",
    eventType: input.eventType ?? "default",
    start: { dateTime: input.startIso },
    end: { dateTime: input.endIso },
    attendees: input.attendees,
    organizer: input.organizer,
  };
}

const hourLong = (
  attendees: readonly {
    email: string;
    displayName?: string;
    resource?: boolean;
    responseStatus?: string;
    self?: boolean;
  }[],
) =>
  event({
    startIso: "2026-07-01T10:00:00Z",
    endIso: "2026-07-01T11:00:00Z",
    attendees,
  });

describe("buildCalendarEstimatePayload", () => {
  it("keeps only attendees on the connected account's domain", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        hourLong([
          { email: "me@acme.com" },
          { email: "colleague@acme.com" },
          { email: "client@other.com" },
        ]),
      ],
    });

    expect(payload.organizerDomain).toBe("acme.com");
    expect(payload.people.map((person) => person.email)).toEqual([
      "me@acme.com",
      "colleague@acme.com",
    ]);
    // The external guest still counts toward the meeting's headcount.
    expect(payload.events[0].totalAttendeeCount).toBe(3);
    expect(payload.events[0].internalAttendeeIndexes).toHaveLength(2);
  });

  it("skips solo blocks, cancelled events, all-day entries, status blocks, and implausibly long events", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        hourLong([{ email: "me@acme.com" }]), // focus block, one attendee
        event({
          startIso: "2026-07-02T10:00:00Z",
          endIso: "2026-07-02T11:00:00Z",
          attendees: [
            { email: "me@acme.com" },
            { email: "colleague@acme.com" },
          ],
          status: "cancelled",
        }),
        { start: { date: "2026-07-03" }, end: { date: "2026-07-04" } }, // all-day
        event({
          startIso: "2026-07-03T10:00:00Z",
          endIso: "2026-07-03T11:00:00Z",
          attendees: [{ email: "me@acme.com" }],
          eventType: "focusTime",
        }),
        event({
          startIso: "2026-07-04T10:00:00Z",
          endIso: "2026-07-05T10:00:00Z",
          attendees: [
            { email: "me@acme.com" },
            { email: "colleague@acme.com" },
          ],
        }),
        hourLong([{ email: "me@acme.com" }, { email: "colleague@acme.com" }]),
      ],
    });

    expect(payload.events).toHaveLength(1);
    expect(payload.skippedEventCount).toBe(5);
    expect(payload.scannedEventCount).toBe(6);
  });

  it("ignores meeting rooms, which are invitees but not people", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        hourLong([
          { email: "me@acme.com" },
          { email: "colleague@acme.com" },
          { email: "room-a@acme.com", resource: true },
        ]),
      ],
    });

    expect(payload.people.map((person) => person.email)).not.toContain(
      "room-a@acme.com",
    );
    expect(payload.events[0].totalAttendeeCount).toBe(2);
  });

  it("uses only the connected person as internal for a personal Google account", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "someone@gmail.com",
      rawEvents: [
        hourLong([
          { email: "someone@gmail.com" },
          { email: "friend@gmail.com" },
        ]),
      ],
    });

    expect(payload.organizerDomain).toBe("");
    expect(payload.people.map((person) => person.email)).toEqual([
      "someone@gmail.com",
    ]);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0].internalAttendeeIndexes).toHaveLength(1);
  });

  it("skips events the connected person declined", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        hourLong([
          {
            email: "me@acme.com",
            self: true,
            responseStatus: "declined",
          },
          { email: "colleague@acme.com", responseStatus: "accepted" },
        ]),
      ],
    });

    expect(payload.events).toHaveLength(0);
    expect(payload.skippedEventCount).toBe(1);
  });

  it("skips a colleague event when the connected person is not participating", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        event({
          startIso: "2026-07-01T10:00:00Z",
          endIso: "2026-07-01T11:00:00Z",
          organizer: { email: "colleague@acme.com" },
          attendees: [
            { email: "colleague@acme.com" },
            { email: "other@acme.com" },
          ],
        }),
      ],
    });

    expect(payload.events).toHaveLength(0);
  });

  it("includes the connected organizer when Google omits them from attendees", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        event({
          startIso: "2026-07-01T10:00:00Z",
          endIso: "2026-07-01T11:00:00Z",
          organizer: { email: "me@acme.com", self: true },
          attendees: [{ email: "client@other.com" }],
        }),
      ],
    });

    expect(payload.events).toHaveLength(1);
    expect(payload.people.map((person) => person.email)).toEqual([
      "me@acme.com",
    ]);
    expect(payload.events[0].totalAttendeeCount).toBe(2);
  });

  it("counts meetings per person and lists the connected account first", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        hourLong([{ email: "me@acme.com" }, { email: "busy@acme.com" }]),
        hourLong([{ email: "me@acme.com" }, { email: "busy@acme.com" }]),
        hourLong([{ email: "me@acme.com" }, { email: "rare@acme.com" }]),
      ],
    });

    expect(payload.people[0].email).toBe("me@acme.com");
    expect(payload.people[0].isSelf).toBe(true);
    // Busiest colleague leads the rest of the list.
    expect(payload.people[1].email).toBe("busy@acme.com");
    expect(payload.people[1].meetingCount).toBe(2);
    expect(payload.people[2].meetingCount).toBe(1);
  });

  it("carries a display name through to the person entry", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        hourLong([
          { email: "me@acme.com" },
          { email: "colleague@acme.com", displayName: "Colleague Name" },
        ]),
      ],
    });

    expect(
      payload.people.find((person) => person.email === "colleague@acme.com")
        ?.name,
    ).toBe("Colleague Name");
  });
});

describe("summarizeConnectedCalendar", () => {
  const threePersonMeeting = buildCalendarEstimatePayload({
    organizerEmail: "me@acme.com",
    rawEvents: [
      hourLong([
        { email: "me@acme.com" },
        { email: "second@acme.com" },
        { email: "third@acme.com" },
      ]),
    ],
    lookbackDays: CALENDAR_LOOKBACK_DAYS,
  });
  const monthlyFactor = DAYS_PER_MONTH / CALENDAR_LOOKBACK_DAYS;

  it("uses the connected calendar as a representative sample", () => {
    const summary = summarizeConnectedCalendar(threePersonMeeting);

    expect(summary.inferredTeamSize).toBe(3);
    expect(summary.observedMeetingHoursPerWeek).toBeCloseTo(
      7 / CALENDAR_LOOKBACK_DAYS,
    );
    expect(summary.observedMeetingCountPerMonth).toBeCloseTo(monthlyFactor);
  });

  it("returns safe defaults when no meetings qualify", () => {
    const summary = summarizeConnectedCalendar({
      ...threePersonMeeting,
      events: [],
    });

    expect(summary.observedMeetingHoursPerWeek).toBe(0);
    expect(summary.observedMeetingCountPerMonth).toBe(0);
  });

  it("normalizes calendar evidence using its actual lookback window", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        hourLong([{ email: "me@acme.com" }, { email: "second@acme.com" }]),
      ],
      lookbackDays: 30,
    });
    const summary = summarizeConnectedCalendar(payload);

    expect(summary.observedMeetingHoursPerWeek).toBeCloseTo(7 / 30);
    expect(summary.observedMeetingCountPerMonth).toBeCloseTo(
      DAYS_PER_MONTH / 30,
    );
  });
});

describe("computeCostFromHours with calendar-measured hours", () => {
  it("prices recorded hours and leaves per-seat comparison to person hours", () => {
    const breakdown = computeCostFromHours({
      teamSize: 3,
      personMeetingHoursPerMonth: 90,
      recordedMeetingHoursPerMonth: 30,
      recordingProviderId: "recall", // $0.50/hr
      sttProviderId: "elevenlabs", // $0.22/hr
      databaseProviderId: "neon",
    });

    // Billed on the 30 recorded hours, not the 90 person hours.
    expect(breakdown.recordingUsdMicros).toBe(30 * 500_000);
    expect(breakdown.sttUsdMicros).toBe(30 * 220_000);
    expect(breakdown.personMeetingHoursPerMonth).toBe(90);
    expect(breakdown.perPersonUsdMicros).toBe(
      Math.round(breakdown.totalUsdMicros / 3),
    );
  });

  it("clamps negative or non-finite hours to zero", () => {
    const breakdown = computeCostFromHours({
      teamSize: 0,
      personMeetingHoursPerMonth: Number.NaN,
      recordedMeetingHoursPerMonth: -5,
      recordingProviderId: "recall",
      sttProviderId: "elevenlabs",
      databaseProviderId: "neon",
    });

    expect(breakdown.recordedMeetingHoursPerMonth).toBe(0);
    expect(breakdown.personMeetingHoursPerMonth).toBe(0);
    expect(breakdown.recordingUsdMicros).toBe(0);
    expect(breakdown.perPersonUsdMicros).toBe(0);
  });
});
