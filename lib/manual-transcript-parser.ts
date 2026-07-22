export type ManualTranscriptSegmentInput = {
  endMs?: number;
  speaker: string;
  startMs: number;
  text: string;
};

const timedCuePattern = /^((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/;

export function parseManualTranscriptText(
  transcriptText: string,
): ManualTranscriptSegmentInput[] {
  const normalizedText = transcriptText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT[^\n]*(?:\n(?!\n)[^\n]*)*\n*/i, "");
  const paragraphs = normalizedText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks = paragraphs.length > 0 ? paragraphs : [transcriptText.trim()];

  return chunks
    .map((chunk) => {
      const lines = chunk.split("\n");
      const timingLineIndex = lines.findIndex((line) =>
        timedCuePattern.test(line.trim()),
      );
      const timedCue =
        timingLineIndex >= 0
          ? lines[timingLineIndex].trim().match(timedCuePattern)
          : null;
      const cueText = (
        timingLineIndex >= 0 ? lines.slice(timingLineIndex + 1).join("\n") : chunk
      ).trim();
      const speakerMatch = cueText.match(/^([^:\n]{1,80}):\s+([\s\S]+)$/);
      const speaker = speakerMatch?.[1]?.trim() || "Speaker 1";
      const text = (speakerMatch?.[2] ?? cueText).trim();

      if (!text) {
        return null;
      }

      return {
        ...(timedCue
          ? {
              endMs: parseCueTimestampMs(timedCue[2]),
              startMs: parseCueTimestampMs(timedCue[1]),
            }
          : { startMs: 0 }),
        speaker,
        text,
      };
    })
    .filter((segment): segment is ManualTranscriptSegmentInput =>
      Boolean(segment),
    );
}

function parseCueTimestampMs(value: string) {
  const parts = value
    .replace(",", ".")
    .split(":");
  const secondsAndMilliseconds = parts.pop() ?? "0";
  const minutes = parts.pop() ?? "0";
  const hours = parts.pop() ?? "0";
  const seconds = Number(secondsAndMilliseconds);

  return (
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Math.round(seconds * 1000)
  );
}
