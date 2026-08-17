export type AudioPlaylistPart = {
  audioUrl: string;
  durationMs: number | null;
  id: string;
  startedAt?: string | null;
};

export type AudioPlaylistPosition = {
  globalTimeSeconds: number;
  localTimeSeconds: number;
  partIndex: number;
  partOffsetSeconds: number;
};

export function getAudioPlaylistDurationSeconds(parts: AudioPlaylistPart[]) {
  return parts.reduce(
    (total, _part, index) =>
      total + getPartDurationSeconds(parts, index),
    0,
  );
}

export function getAudioPlaylistPartOffsetSeconds(
  parts: AudioPlaylistPart[],
  partIndex: number,
) {
  return parts
    .slice(0, partIndex)
    .reduce(
      (total, _part, index) =>
        total + getPartDurationSeconds(parts, index),
      0,
    );
}

export function getAudioPlaylistPosition(
  parts: AudioPlaylistPart[],
  requestedTimeSeconds: number,
): AudioPlaylistPosition | null {
  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    const globalTimeSeconds = Math.max(0, requestedTimeSeconds);

    return {
      globalTimeSeconds,
      localTimeSeconds: globalTimeSeconds,
      partIndex: 0,
      partOffsetSeconds: 0,
    };
  }

  const durationSeconds = getAudioPlaylistDurationSeconds(parts);
  const globalTimeSeconds = Math.min(
    Math.max(0, requestedTimeSeconds),
    durationSeconds,
  );
  let partOffsetSeconds = 0;

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const partDurationSeconds = getPartDurationSeconds(parts, partIndex);
    const isLastPart = partIndex === parts.length - 1;

    if (
      isLastPart ||
      globalTimeSeconds < partOffsetSeconds + partDurationSeconds
    ) {
      return {
        globalTimeSeconds,
        localTimeSeconds: Math.max(
          0,
          Math.min(globalTimeSeconds - partOffsetSeconds, partDurationSeconds),
        ),
        partIndex,
        partOffsetSeconds,
      };
    }

    partOffsetSeconds += partDurationSeconds;
  }

  return null;
}

function getPartDurationSeconds(
  parts: AudioPlaylistPart[],
  partIndex: number,
) {
  const part = parts[partIndex];

  if (typeof part?.durationMs === "number" && part.durationMs > 0) {
    return part.durationMs / 1000;
  }

  const startedAt = toTimestamp(part?.startedAt);
  const nextStartedAt = toTimestamp(parts[partIndex + 1]?.startedAt);

  return startedAt !== null && nextStartedAt !== null
    ? Math.max(0, nextStartedAt - startedAt) / 1000
    : 0;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}
