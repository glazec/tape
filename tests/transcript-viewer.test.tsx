import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TranscriptViewer } from "@/components/transcript-viewer";

const segments = [
  {
    id: "segment_123",
    speaker: "Speaker 1",
    startMs: 0,
    endMs: 1000,
    text: "Hello team",
  },
];
const pacedText = Array.from({ length: 60 }, (_, index) => `word${index}`).join(
  " ",
);

describe("TranscriptViewer", () => {
  it("hides speaker editing when no meeting id is provided", () => {
    const html = renderToStaticMarkup(<TranscriptViewer segments={segments} />);

    expect(html).toContain("Speaker 1");
    expect(html).not.toContain("Edit speaker");
  });

  it("shows speaker editing for workspace meeting pages", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={segments}
      />,
    );

    expect(html).toContain("Edit speaker");
  });

  it("shows Chinese translation first while keeping original text available", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={[
          {
            ...segments[0],
            translatedText: "大家好",
          },
        ]}
      />,
    );

    expect(html).toContain("中文");
    expect(html).toContain("大家好");
    expect(html).toContain("Original sentence");
    expect(html).toContain("Hello team");
  });

  it("shows translation correction controls for workspace meetings", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        meetingId="11111111-1111-4111-8111-111111111111"
        segments={[
          {
            ...segments[0],
            translatedText: "大家好",
          },
        ]}
      />,
    );

    expect(html).toContain("Edit translation");
  });

  it("shows emotion labels without exposing model details", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        segments={[
          {
            ...segments[0],
            emotionLabel: "hard",
            emotionReason: "High pressure words or fast pace",
          },
        ]}
      />,
    );

    expect(html).toContain("Hard");
    expect(html).not.toContain("High pressure words or fast pace");
  });

  it("overlays speaker, emotion, and wpm labels on the waveform", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            endMs: 30000,
            emotionLabel: "hard",
            text: pacedText,
          },
        ]}
      />,
    );

    expect(html).toContain("Speaker 1 · Hard");
    expect(html).toContain("120 wpm");
    expect(html).toContain(
      'aria-label="Audio waveform, Speaker 1 · Hard, 120 wpm"',
    );
    expect(html).toContain("<svg");
    expect(html).toContain("<polyline");
    expect(html).toContain("top-1 h-1 overflow-hidden rounded-full");
    expect(html).toContain("bottom-1 z-20 h-1 overflow-hidden rounded-full");
    expect(
      (html.match(/background-color:#2563eb/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(html).toContain('title="Speaker 1"');
    expect(html).toContain('title="Hard emotion"');
    expect(html).toContain('stroke="#f97316"');
  });

  it("keeps neutral waveform labels to the speaker name", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            endMs: 30000,
            emotionLabel: "neutral",
            text: pacedText,
          },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Audio waveform, Speaker 1, 120 wpm"');
    expect(html).not.toContain("Speaker 1 · Neutral");
    expect(html).toContain('title="Neutral emotion"');
  });

  it("uses multilingual words for smoothed waveform pace", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            endMs: 30000,
            text: "听得到吗我们开始讨论会议记录和后续事项".repeat(6),
          },
        ]}
      />,
    );

    expect(html).toMatch(/Audio waveform, Speaker 1, (?!0 wpm)\d+ wpm/);
    expect(html).toContain('stroke="#f97316"');
  });
});
