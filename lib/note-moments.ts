import type { NoteMoment } from "@/lib/meeting-note-document";

export const NOTE_MOMENT_NAVIGATE = "tape:note-moment";
export const NOTE_PLAYBACK_POSITION = "tape:note-playback-position";
export type NoteMomentNavigation = {
  meetingId: string;
  timestampMs: number;
  handled?: boolean;
};
export type NotePlaybackPosition = { meetingId: string; timestampMs: number };
export type NoteMomentRecording = {
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
};
export type NoteMomentSource = {
  id: string;
  durationMs: number | null;
  recordings: NoteMomentRecording[];
  hasTranscript: boolean;
  recording?: boolean;
};

export function formatNoteMoment(timestampMs: number) {
  const seconds = Math.floor(timestampMs / 1000);
  const hours = Math.floor(seconds / 3600);
  return hours > 0
    ? `${hours}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function parseNoteMoments(text: string) {
  return Array.from(
    text.matchAll(/\[(?:(\d{1,4}):([0-5]\d):([0-5]\d)|(\d{1,5}):([0-5]\d))\]/g),
    (match) => ({
      start: match.index,
      text: match[0],
      timestampMs:
        match[1] !== undefined
          ? (Number(match[1]) * 3600 +
              Number(match[2]) * 60 +
              Number(match[3])) *
            1000
          : (Number(match[4]) * 60 + Number(match[5])) * 1000,
    }),
  );
}

// Preserve only unchanged marker text outside the edited range. Editing a time
// deliberately turns it into an explicit playback timestamp.
export function reconcileNoteMoments(
  before: string,
  after: string,
  moments: NoteMoment[] = [],
  cursor?: number,
) {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  // The caret disambiguates deleting or inserting one of several identical
  // markers. A text-only prefix diff could otherwise keep the wrong anchor.
  const delta = after.length - before.length;
  if (cursor !== undefined && delta !== 0) {
    const editStart = delta > 0 ? cursor - delta : cursor;
    const editEnd = delta > 0 ? editStart : cursor - delta;
    if (
      editStart >= 0 &&
      before.slice(0, editStart) === after.slice(0, editStart) &&
      before.slice(editEnd) === after.slice(cursor)
    ) {
      prefix = editStart;
      suffix = before.length - editEnd;
    }
  }
  return moments.flatMap((moment) => {
    if (moment.start + moment.text.length <= prefix) return [moment];
    if (moment.start >= before.length - suffix)
      return [
        { ...moment, start: moment.start + after.length - before.length },
      ];
    return [];
  });
}

export function resolveNoteMoment(
  moment: NoteMoment,
  recordings: NoteMomentRecording[],
) {
  if (moment.playbackMs !== undefined) return moment.playbackMs;
  if (!moment.capturedAt) return null;
  const captured = Date.parse(moment.capturedAt);
  let offset = 0;
  for (const recording of recordings) {
    const start = recording.startedAt ? Date.parse(recording.startedAt) : NaN;
    const end = recording.endedAt ? Date.parse(recording.endedAt) : NaN;
    if (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      captured >= start &&
      captured <= end &&
      recording.durationMs !== null
    ) {
      return offset + Math.min(recording.durationMs, captured - start);
    }
    if (recording.durationMs === null) return null;
    offset += recording.durationMs;
  }
  return null;
}

export function explicitMomentTarget(
  timestampMs: number,
  sources: NoteMomentSource[],
) {
  let offset = 0;
  for (const [index, source] of sources.entries()) {
    if (source.durationMs === null)
      return sources.length === 1
        ? { meetingId: source.id, timestampMs }
        : null;
    if (
      timestampMs < offset + source.durationMs ||
      (index === sources.length - 1 &&
        timestampMs === offset + source.durationMs)
    )
      return { meetingId: source.id, timestampMs: timestampMs - offset };
    offset += source.durationMs;
  }
  return null;
}
