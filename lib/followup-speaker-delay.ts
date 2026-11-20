export const SPEAKER_EDIT_DELAY_MS = 60_000;

export function speakerEditDelayRemaining(lastEditMs = 0) {
  return Math.max(0, lastEditMs + SPEAKER_EDIT_DELAY_MS - Date.now());
}
