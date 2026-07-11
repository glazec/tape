import { describe, expect, it } from "vitest";

import {
  buildScreenShareIntervals,
  parseRecallParticipantEvents,
} from "@/lib/recall-screen-share";

function event(
  action: "screenshare_on" | "screenshare_off",
  participantId: string | number,
  relative: number,
) {
  return {
    action,
    participant: { id: participantId },
    timestamp: { relative },
  };
}

describe("parseRecallParticipantEvents", () => {
  it("keeps only screen share events", () => {
    expect(
      parseRecallParticipantEvents([
        event("screenshare_on", 7, 10),
        {
          action: "speech_on",
          participant: { id: 7 },
          timestamp: { relative: 11 },
        },
        event("screenshare_off", "7", 20),
      ]),
    ).toEqual([
      event("screenshare_on", 7, 10),
      event("screenshare_off", "7", 20),
    ]);
  });

  it("returns no events when the artifact contains only speech_on", () => {
    expect(
      parseRecallParticipantEvents([
        {
          action: "speech_on",
          participant: { id: 7 },
          timestamp: { relative: 11 },
        },
      ]),
    ).toEqual([]);
  });

  it("throws for a malformed top level value", () => {
    expect(() => parseRecallParticipantEvents({ events: [] })).toThrow();
  });

  it("throws for a malformed screen share event", () => {
    expect(() =>
      parseRecallParticipantEvents([
        {
          action: "screenshare_on",
          participant: {},
          timestamp: { relative: 10 },
        },
      ]),
    ).toThrow();
    expect(() =>
      parseRecallParticipantEvents([
        {
          action: "screenshare_off",
          participant: { id: 7 },
          timestamp: { relative: -1 },
        },
      ]),
    ).toThrow();
  });
});

describe("buildScreenShareIntervals", () => {
  it("merges overlapping shares across participants", () => {
    const events = parseRecallParticipantEvents([
      event("screenshare_on", "alice", 10),
      event("screenshare_on", "bob", 12),
      event("screenshare_off", "alice", 20),
      event("screenshare_off", "bob", 25),
    ]);

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual([
      { startMs: 10_000, endMs: 25_000 },
    ]);
  });

  it("closes an unmatched on event at the recording duration", () => {
    const events = parseRecallParticipantEvents([
      event("screenshare_on", "alice", 58),
    ]);

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual([
      { startMs: 58_000, endMs: 60_000 },
    ]);
  });

  it("ignores an unmatched off event", () => {
    const events = parseRecallParticipantEvents([
      event("screenshare_off", "alice", 20),
    ]);

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual(
      [],
    );
  });

  it("keeps the earliest start for duplicate on events", () => {
    const events = parseRecallParticipantEvents([
      event("screenshare_on", "alice", 10),
      event("screenshare_on", "alice", 12),
      event("screenshare_off", "alice", 20),
    ]);

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual([
      { startMs: 10_000, endMs: 20_000 },
    ]);
  });

  it("keeps adjacent intervals separate", () => {
    const events = parseRecallParticipantEvents([
      event("screenshare_on", "alice", 10),
      event("screenshare_off", "alice", 12),
      event("screenshare_on", "bob", 12),
      event("screenshare_off", "bob", 14),
    ]);

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual([
      { startMs: 10_000, endMs: 12_000 },
      { startMs: 12_000, endMs: 14_000 },
    ]);
  });

  it("discards intervals shorter than two seconds", () => {
    const events = parseRecallParticipantEvents([
      event("screenshare_on", "alice", 10),
      event("screenshare_off", "alice", 11.999),
    ]);

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual(
      [],
    );
  });

  it("retains intervals exactly two seconds long", () => {
    const events = parseRecallParticipantEvents([
      event("screenshare_on", "alice", 10),
      event("screenshare_off", "alice", 12),
    ]);

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual([
      { startMs: 10_000, endMs: 12_000 },
    ]);
  });

  it("clamps out of range timestamps to the recording bounds", () => {
    const events = [
      event("screenshare_on", "alice", -1),
      event("screenshare_off", "alice", 3),
      event("screenshare_on", "bob", 58),
      event("screenshare_off", "bob", 65),
    ];

    expect(buildScreenShareIntervals({ durationMs: 60_000, events })).toEqual([
      { startMs: 0, endMs: 3_000 },
      { startMs: 58_000, endMs: 60_000 },
    ]);
  });

  it("throws for an invalid recording duration", () => {
    expect(() =>
      buildScreenShareIntervals({ durationMs: Number.NaN, events: [] }),
    ).toThrow();
    expect(() =>
      buildScreenShareIntervals({ durationMs: -1, events: [] }),
    ).toThrow();
  });
});
