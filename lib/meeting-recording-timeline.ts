type RecordingPartTiming = {
  durationMs: number | null;
  startedAt: string | null;
};

export function getRecordingPartOffsetMs(
  parts: RecordingPartTiming[],
  partIndex: number,
) {
  const firstStartedAt = toTimestamp(parts[0]?.startedAt);
  const partStartedAt = toTimestamp(parts[partIndex]?.startedAt);

  if (firstStartedAt !== null && partStartedAt !== null) {
    return Math.max(0, partStartedAt - firstStartedAt);
  }

  return parts
    .slice(0, partIndex)
    .reduce((total, part) => total + Math.max(0, part.durationMs ?? 0), 0);
}

export function getRecordingPartEndOffsetMs(
  parts: RecordingPartTiming[],
  partIndex: number,
) {
  return partIndex + 1 < parts.length
    ? getRecordingPartOffsetMs(parts, partIndex + 1)
    : Number.POSITIVE_INFINITY;
}

export function getAppendedRecordingPartOffsetMs(
  parts: RecordingPartTiming[],
  partIndex: number,
) {
  return parts
    .slice(0, partIndex)
    .reduce((total, part) => total + Math.max(0, part.durationMs ?? 0), 0);
}

export function moveRecordingTimestampToAppendedTimeline(
  parts: RecordingPartTiming[],
  timestampMs: number,
) {
  if (parts.length < 2) {
    return timestampMs;
  }

  let partIndex = 0;

  for (let index = 1; index < parts.length; index += 1) {
    if (timestampMs < getRecordingPartOffsetMs(parts, index)) {
      break;
    }

    partIndex = index;
  }

  const sourceOffsetMs = getRecordingPartOffsetMs(parts, partIndex);
  const appendedOffsetMs = getAppendedRecordingPartOffsetMs(parts, partIndex);

  return Math.max(0, timestampMs - sourceOffsetMs + appendedOffsetMs);
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}
