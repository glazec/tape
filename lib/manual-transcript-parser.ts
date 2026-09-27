export type ManualTranscriptSegmentInput = {
  endMs?: number;
  speaker: string;
  startMs: number;
  text: string;
};

const timedCuePattern = /^((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})(?:\s+.*)?$/;
const sparkCuePattern = /^((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$/;
const sparkFooterPattern = /^由\s*Spark\s*\+AI\s*会议记录\s*驱动$/iu;
const sparkMeetingTimePattern = /^\d{1,2}:\d{2}\s*(?:上午|下午|AM|PM)\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:上午|下午|AM|PM)\s+GMT[+-]\d{2}:\d{2}$/iu;
const trailingSparkTimestampPattern = /\s*\[(?:\d{1,2}:)?\d{1,2}:\d{2}\]\s*$/;

export function parseManualTranscriptText(
  transcriptText: string,
): ManualTranscriptSegmentInput[] {
  const normalizedText = transcriptText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT[^\n]*(?:\n(?!\n)[^\n]*)*\n*/i, "");
  const hasTimedCue = normalizedText
    .split("\n")
    .some((line) => timedCuePattern.test(line.trim()));

  if (!hasTimedCue && isSparkMeetingNote(normalizedText)) {
    return parseSparkMeetingNote(normalizedText);
  }

  const paragraphs = normalizedText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(
      (paragraph) => paragraph && !sparkFooterPattern.test(paragraph),
    );
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
      const { speaker, text } = parseSpeakerAndText(cueText);

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

function isSparkMeetingNote(transcriptText: string) {
  const lines = transcriptText.split("\n").map((line) => line.trim());

  return (
    lines.some((line) => sparkFooterPattern.test(line)) ||
    (lines.some((line) => sparkMeetingTimePattern.test(line)) &&
      lines.some(
        (line) => sparkCuePattern.test(line) && !sparkMeetingTimePattern.test(line),
      ))
  );
}

function parseSparkMeetingNote(
  transcriptText: string,
): ManualTranscriptSegmentInput[] {
  const segments: ManualTranscriptSegmentInput[] = [];
  let currentCue: { startMs: number; text: string[] } | null = null;

  function addCurrentCue() {
    if (!currentCue) {
      return;
    }

    const cueText = currentCue.text
      .join("\n")
      .replace(trailingSparkTimestampPattern, "")
      .trim();
    const { speaker, text } = parseSpeakerAndText(cueText);

    if (text) {
      segments.push({ speaker, startMs: currentCue.startMs, text });
    }
  }

  for (const rawLine of transcriptText.split("\n")) {
    const line = rawLine.trim();

    if (sparkFooterPattern.test(line)) {
      break;
    }

    const cue = sparkMeetingTimePattern.test(line)
      ? null
      : line.match(sparkCuePattern);

    if (cue) {
      addCurrentCue();
      currentCue = {
        startMs: parseCueTimestampMs(cue[1]),
        text: [cue[2]],
      };
    } else if (line && currentCue) {
      currentCue.text.push(line);
    }
  }

  addCurrentCue();

  return segments;
}

function parseSpeakerAndText(cueText: string) {
  const speakerMatch = cueText.match(/^([^:\n：]{1,80})[:：]\s+([\s\S]+)$/);

  return {
    speaker: speakerMatch?.[1]?.trim() || "Speaker 1",
    text: (speakerMatch?.[2] ?? cueText).trim(),
  };
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
