import { afterEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  delete: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

import {
  buildRecallRealtimeParticipantTimelineUpdate,
  fetchAndPersistRecallParticipantTimeline,
  listMeetingParticipantTimeline,
  parseRecallParticipantTimeline,
  persistRecallRealtimeParticipantTimelineEvent,
} from "@/lib/meeting-participant-timeline";

vi.mock("@/db/client", () => ({
  db,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

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

  it("rejects unsupported, incomplete, and timestamp-free events", () => {
    expect(buildRecallRealtimeParticipantTimelineUpdate({ event: "other" })).toEqual({ action: "skip", reason: "unsupported_event" });
    expect(buildRecallRealtimeParticipantTimelineUpdate({
      event: "participant_events.speech_on",
      data: { data: { participant: {} }, recording: { metadata: { meetingId: "meeting" } } },
    })).toEqual({ action: "skip", reason: "missing_participant" });
    expect(buildRecallRealtimeParticipantTimelineUpdate({
      event: "participant_events.speech_on",
      data: { data: { participant: { name: "Alice" } }, bot: { metadata: { meetingId: "meeting" } } },
    })).toEqual({ action: "skip", reason: "missing_timestamp" });
  });
});

describe("participant timeline persistence", () => {
  it("downloads, parses, replaces, and stores a Recall timeline", async () => {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn().mockResolvedValue(undefined);
    db.delete.mockReturnValue({ where: deleteWhere });
    db.insert.mockReturnValue({ values: insertValues });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ timeline: [
      { participant_id: "p1", participant_name: "Alice", start_ms: 100, end_ms: 900 },
    ] })));

    await expect(fetchAndPersistRecallParticipantTimeline({ meetingId: "meeting", timelineUrl: "https://timeline" })).resolves.toEqual({ count: 1 });
    expect(deleteWhere).toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith([expect.objectContaining({ meetingId: "meeting", startMs: 100 })]);
  });

  it("fails a timeline download with the Recall status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503, statusText: "Unavailable" })));
    await expect(fetchAndPersistRecallParticipantTimeline({ meetingId: "meeting", timelineUrl: "https://timeline" })).rejects.toThrow("503 Unavailable");
  });

  it("stores speech starts and closes matching speech stops", async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    db.insert.mockReturnValue({ values: vi.fn(() => ({ onConflictDoNothing })) });
    const speechOn = realtime("participant_events.speech_on");
    await expect(persistRecallRealtimeParticipantTimelineEvent(speechOn)).resolves.toMatchObject({ action: "speech_on" });
    expect(onConflictDoNothing).toHaveBeenCalled();

    db.select.mockReturnValue(selectChain([{ id: "row_1" }]));
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    db.update.mockReturnValue({ set: vi.fn(() => ({ where: updateWhere })) });
    await expect(persistRecallRealtimeParticipantTimelineEvent(realtime("participant_events.speech_off"))).resolves.toMatchObject({ action: "speech_off" });
    expect(updateWhere).toHaveBeenCalled();
  });

  it("returns skip updates without writing and lists stored rows", async () => {
    await expect(persistRecallRealtimeParticipantTimelineEvent({ event: "other" })).resolves.toEqual({ action: "skip", reason: "unsupported_event" });
    expect(db.insert).not.toHaveBeenCalled();

    const rows = [{ participantId: "p1", name: "Alice", email: null, startMs: 0, endMs: 10 }];
    db.select.mockReturnValue(selectChain(rows));
    await expect(listMeetingParticipantTimeline("meeting")).resolves.toEqual(rows);
  });
});

function realtime(event: string) {
  return {
    event,
    data: {
      data: { participant: { id: "p1", name: "Alice" }, timestamp: { relative: 2 } },
      participant_events: { metadata: { meetingId: "meeting" } },
    },
  };
}

function selectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn(() => chain),
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
    where: vi.fn(() => chain),
  };
  return chain;
}
