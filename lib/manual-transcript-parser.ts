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
const markdownRulePattern = /^(?:-{3,}|\*{3,}|_{3,})$/;
const markdownHeadingPattern = /^#{1,6}\s+\S/;
const markdownPreambleLinePattern = /^(?:#{1,6}\s+\S|[-*+]\s+\S|>\s*\S|[^:：\n]{1,40}[:：]\s*\S)/;
const speakerLinePattern = /^([^:：\n]{1,40}?)[:：][ \t]*(\S.*)$/;
const speakerNameRejectPattern = /[。，,！!？?；;「」“”"()（）[\]<>]|^\d+$|^[-*+>#]/;
const maxMarkdownPreambleLines = 40;
// Front matter keys are lowercase identifiers ("title:", "date:"); capitalized
// "Alice: Hello" lines are speaker labels.
const yamlFrontMatterLinePattern = /^(?:[a-z_][a-z0-9_-]*\s*:(?:\s|$)|\s+\S|-\s)/;

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

  const bodyText = hasTimedCue
    ? normalizedText
    : stripMarkdownPreamble(normalizedText);
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(
      (paragraph) =>
        paragraph &&
        !sparkFooterPattern.test(paragraph) &&
        !isMarkdownDecoration(paragraph),
    );
  const chunks = paragraphs.length > 0 ? paragraphs : [transcriptText.trim()];

  return chunks
    .flatMap((chunk) => {
      const speakerLines = hasTimedCue ? null : parseSpeakerLines(chunk);

      if (speakerLines) {
        return speakerLines;
      }

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

/**
 * Drops a Markdown document header (title, "- key: value" metadata bullets,
 * YAML front matter) that ends with a horizontal rule before the transcript.
 */
function stripMarkdownPreamble(text: string) {
  const lines = text.split("\n");
  let start = 0;

  while (start < lines.length && !lines[start].trim()) {
    start += 1;
  }

  if (markdownRulePattern.test(lines[start]?.trim() ?? "")) {
    const frontMatterEnd = lines.findIndex(
      (line, index) =>
        index > start &&
        index <= start + maxMarkdownPreambleLines &&
        markdownRulePattern.test(line.trim()),
    );
    // Only YAML-like "key: value" content counts as front matter; a leading
    // "---" divider above real transcript text must not delete that text.
    const isFrontMatter =
      frontMatterEnd > start + 1 &&
      lines
        .slice(start + 1, frontMatterEnd)
        .every(
          (line) =>
            !line.trim() ||
            yamlFrontMatterLinePattern.test(line),
        );

    return isFrontMatter ? lines.slice(frontMatterEnd + 1).join("\n") : text;
  }

  const ruleIndex = lines.findIndex(
    (line, index) =>
      index >= start &&
      index < start + maxMarkdownPreambleLines &&
      markdownRulePattern.test(line.trim()),
  );

  if (ruleIndex < 0) {
    return text;
  }

  const preamble = lines
    .slice(start, ruleIndex)
    .map((line) => line.trim())
    .filter(Boolean);
  const isDocumentHeader =
    preamble.length > 0 &&
    markdownHeadingPattern.test(preamble[0]) &&
    preamble.every((line) => markdownPreambleLinePattern.test(line));

  return isDocumentHeader ? lines.slice(ruleIndex + 1).join("\n") : text;
}

function isMarkdownDecoration(paragraph: string) {
  return paragraph
    .split("\n")
    .every(
      (line) =>
        markdownRulePattern.test(line.trim()) ||
        markdownHeadingPattern.test(line.trim()),
    );
}

/**
 * Parses "Name: text" transcripts that put one utterance per line without
 * blank lines between them. Lines without a speaker label continue the
 * previous utterance.
 */
function parseSpeakerLines(
  chunk: string,
): ManualTranscriptSegmentInput[] | null {
  const lines = chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !markdownRulePattern.test(line));

  if (lines.length < 2) {
    return null;
  }

  const labeledLines = lines.map(matchSpeakerLine);
  const labeledCount = labeledLines.filter(Boolean).length;

  if (!labeledLines[0] || labeledCount < 2 || labeledCount * 2 < lines.length) {
    return null;
  }

  // "Alice: the plan is:" followed by "Step one: ship it" is one utterance
  // introducing a list, not a change of speaker.
  if (labeledLines.some((labeled) => labeled && /[:：]$/.test(labeled.text))) {
    return null;
  }

  const segments: ManualTranscriptSegmentInput[] = [];

  lines.forEach((line, index) => {
    const labeled = labeledLines[index];

    if (labeled) {
      segments.push({ speaker: labeled.speaker, startMs: 0, text: labeled.text });
    } else {
      const previous = segments[segments.length - 1];
      previous.text = `${previous.text}\n${line}`;
    }
  });

  return segments;
}

function matchSpeakerLine(line: string) {
  const match = line.match(speakerLinePattern);
  const speaker = match?.[1]?.trim();
  const text = match?.[2]?.trim();

  if (
    !speaker ||
    !text ||
    speakerNameRejectPattern.test(speaker) ||
    text.startsWith("//") ||
    // A clock time in prose ("We met at 3:30") is not a speaker label.
    (/\d$/.test(speaker) && /^\d/.test(text))
  ) {
    return null;
  }

  return { speaker, text };
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
