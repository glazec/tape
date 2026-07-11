export type ScreenShareInterval = {
  startMs: number;
  endMs: number;
};

export type RecallParticipantEvent = {
  action: "screenshare_on" | "screenshare_off";
  participant: {
    id: string | number;
  };
  timestamp: {
    relative: number;
  };
};

export function parseRecallParticipantEvents(
  input: unknown,
): RecallParticipantEvent[] {
  if (!Array.isArray(input)) {
    throw new Error("Recall participant events must be an array");
  }

  const events: RecallParticipantEvent[] = [];

  for (const value of input) {
    const record = getRecord(value);
    const action = record?.action;

    if (action !== "screenshare_on" && action !== "screenshare_off") {
      continue;
    }

    const participant = getRecord(record?.participant);
    const timestamp = getRecord(record?.timestamp);
    const participantId = participant?.id;
    const relative = timestamp?.relative;

    if (
      (typeof participantId !== "string" && typeof participantId !== "number") ||
      typeof relative !== "number" ||
      !Number.isFinite(relative) ||
      relative < 0
    ) {
      throw new Error("Malformed Recall screen share event");
    }

    events.push({
      action,
      participant: { id: participantId },
      timestamp: { relative },
    });
  }

  return events;
}

export function buildScreenShareIntervals(input: {
  durationMs: number;
  events: RecallParticipantEvent[];
}): ScreenShareInterval[] {
  const { durationMs, events } = input;

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("Recording duration must be finite and nonnegative");
  }

  const activeShares = new Map<string, number>();
  const intervals: ScreenShareInterval[] = [];

  for (const event of events) {
    const participantId = String(event.participant.id);
    const timestampMs = clamp(event.timestamp.relative * 1000, durationMs);

    if (event.action === "screenshare_on") {
      const activeStart = activeShares.get(participantId);
      activeShares.set(
        participantId,
        activeStart === undefined
          ? timestampMs
          : Math.min(activeStart, timestampMs),
      );
      continue;
    }

    const startMs = activeShares.get(participantId);

    if (startMs === undefined) {
      continue;
    }

    activeShares.delete(participantId);

    if (timestampMs >= startMs) {
      intervals.push({ startMs, endMs: timestampMs });
    }
  }

  for (const startMs of activeShares.values()) {
    intervals.push({ startMs, endMs: durationMs });
  }

  intervals.sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );

  const merged: ScreenShareInterval[] = [];

  for (const interval of intervals) {
    const previous = merged.at(-1);

    if (previous && interval.startMs < previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged.filter((interval) => interval.endMs - interval.startMs >= 2000);
}

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function clamp(value: number, maximum: number) {
  return Math.min(maximum, Math.max(0, value));
}
