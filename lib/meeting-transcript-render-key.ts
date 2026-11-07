/**
 * Key for the meeting TranscriptViewer.
 *
 * Only changes that need a fresh viewer belong here. Translation and polish
 * progress arrive every few seconds through router.refresh while a meeting
 * is processing; keying on them remounted the viewer, which destroyed the
 * audio element and stopped playback. The viewer syncs those props in place.
 */
export function getTranscriptViewerRenderKey({
  displayStatus,
  meetingId,
}: {
  displayStatus: string;
  meetingId: string;
}) {
  return [meetingId, displayStatus].join(":");
}
