export function getTranscriptViewerRenderKey({
  displayStatus,
  meetingId,
  polishedSegments,
  segmentCount,
  translatedSegments,
  translationStatus,
}: {
  displayStatus: string;
  meetingId: string;
  polishedSegments: number;
  segmentCount: number;
  translatedSegments: number;
  translationStatus?: string | null;
}) {
  return [
    meetingId,
    displayStatus,
    segmentCount,
    polishedSegments,
    translationStatus ?? "unknown",
    translatedSegments,
  ].join(":");
}
