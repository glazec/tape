import { describe, expect, it, vi } from "vitest";

import {
  buildRecallRealtimeParticipantTimelineUpdate,
  parseRecallParticipantTimeline,
} from "@/lib/meeting-participant-timeline";

vi.mock("@/db/client", () => ({
  db: {},
}));

describe("parseRecallParticipantTimeline", () => {
  it("parses Recall speaker timeline download schema", () => {
    expect(
      parseRecallParticipantTimeline([
        {
          participant: {
            id: 7,
            name: "Alice Chen",
            email: "alice@example.com",
          },
          start_timestamp: {
            absolute: "2026-06-27T16:00:12.500Z",
            relative: 12.5,
          },
          end_timestamp: {
            absolute: "2026-06-27T16:00:18.250Z",
            relative: 18.25,
          },
        },
      ]),
    ).toEqual([
      {
        participantId: "7",
        name: "Alice Chen",
        email: "alice@example.com",
        startMs: 12500,
        endMs: 18250,
      },
    ]);
  });
});

describe("buildRecallRealtimeParticipantTimelineUpdate", () => {
  it("builds a speech start update from Recall realtime participant events", () => {
    expect(
      buildRecallRealtimeParticipantTimelineUpdate({
        event: "participant_events.speech_on",
        data: {
          data: {
            participant: {
              id: 7,
              name: "Alice Chen",
              email: "alice@example.com",
            },
            timestamp: {
              relative: 12.5,
            },
          },
          recording: {
            metadata: {
              meetingId: "11111111-1111-4111-8111-111111111111",
            },
          },
        },
      }),
    ).toEqual({
      action: "speech_on",
      entry: {
        email: "alice@example.com",
        endMs: null,
        meetingId: "11111111-1111-4111-8111-111111111111",
        name: "Alice Chen",
        participantId: "7",
        startMs: 12500,
      },
    });
  });

  it("builds a speech stop update from Recall realtime participant events", () => {
    expect(
      buildRecallRealtimeParticipantTimelineUpdate({
        event: "participant_events.speech_off",
        data: {
          data: {
            participant: {
              id: 7,
              name: "Alice Chen",
              email: "alice@example.com",
            },
            timestamp: {
              relative: 18.25,
            },
          },
          recording: {
            metadata: {
              meeting_id: "11111111-1111-4111-8111-111111111111",
            },
          },
        },
      }),
    ).toEqual({
      action: "speech_off",
      entry: {
        email: "alice@example.com",
        endMs: 18250,
        meetingId: "11111111-1111-4111-8111-111111111111",
        name: "Alice Chen",
        participantId: "7",
        startMs: 18250,
      },
    });
  });

  it("ignores realtime participant events without meeting metadata", () => {
    expect(
      buildRecallRealtimeParticipantTimelineUpdate({
        event: "participant_events.speech_on",
        data: {
          data: {
            participant: {
              id: 7,
              name: "Alice Chen",
            },
            timestamp: {
              relative: 12.5,
            },
          },
        },
      }),
    ).toEqual({ action: "skip", reason: "missing_meeting_id" });
  });
});
