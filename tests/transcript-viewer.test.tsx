import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getWaveformHoverSnapshot,
  TranscriptViewer,
} from "@/components/transcript-viewer";

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

  it("places the timestamp after the speaker before the sentence", () => {
    const html = renderToStaticMarkup(<TranscriptViewer segments={segments} />);

    expect(html.indexOf("Speaker 1")).toBeLessThan(html.indexOf("0:00"));
    expect(html.indexOf("0:00")).toBeLessThan(html.indexOf("Hello"));
  });

  it("makes transcript words seekable when audio is available", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer audioUrl="/audio.mp3" segments={segments} />,
    );

    expect(html).toContain('aria-label="Play transcript from 0:00"');
    expect(html).toContain('data-transcript-word-index="0"');
    expect(html).toContain('data-transcript-word-index="1"');
  });

  it("keeps transcript words read only when audio is unavailable", () => {
    const html = renderToStaticMarkup(<TranscriptViewer segments={segments} />);

    expect(html).not.toContain("Play transcript from 0:00");
    expect(html).not.toContain("hover:bg-primary/15");
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

  it("shows Chinese translation first with original text on hover", () => {
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
    expect(html).toContain("大家");
    expect(html).toContain("好");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("group-hover/original:opacity-100");
    expect(html).toContain("Hello team");
    expect(html).not.toContain("Original sentence");
  });

  it("hides translation correction controls on workspace meetings", () => {
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

    expect(html).not.toContain("Edit translation");
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
    expect(html).toContain("Words per minute trend");
    expect(html).not.toContain("<polygon");
    expect(html).toContain('stroke-dasharray="2 3"');
    expect(html).toContain("<polyline");
    expect(html).toContain("group-hover/rail:opacity-100");
    expect(html).toContain("top-0 z-40 h-6");
    expect(html).toContain("bottom-0 z-40 h-6");
    expect(html).toContain("group-hover/wpm:opacity-100");
    expect(html).toContain("WPM trend: 120 wpm");
    expect(html).toContain("Speaker: Speaker 1");
    expect(html).toContain("Emotion: Hard");
    expect(html).toContain("WPM: 120 wpm");
    expect(
      (html.match(/background-color:#2563eb/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(html).toContain('title="Speaker 1"');
    expect(html).toContain('title="Hard emotion"');
    expect(html).toContain('stroke="#f97316"');
  });

  it("shows 5 second backward and forward controls on the audio player", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer audioUrl="/audio.mp3" segments={segments} />,
    );

    expect(html).toContain('aria-label="Skip back 5 seconds"');
    expect(html).toContain('aria-label="Skip forward 5 seconds"');
    expect((html.match(/5s/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("grid-cols-2");
    expect(html).toContain("col-span-2");
  });

  it("calculates the WPM tooltip from the hovered waveform position", () => {
    const lowPace = getWaveformHoverSnapshot({
      boundsLeft: 0,
      boundsWidth: 100,
      clientX: 25,
      samples: [
        { endSecond: 120, startSecond: 0, wordCount: 120 },
        { endSecond: 240, startSecond: 120, wordCount: 480 },
      ],
      timelineDuration: 240,
    });
    const highPace = getWaveformHoverSnapshot({
      boundsLeft: 0,
      boundsWidth: 100,
      clientX: 75,
      samples: [
        { endSecond: 120, startSecond: 0, wordCount: 120 },
        { endSecond: 240, startSecond: 120, wordCount: 480 },
      ],
      timelineDuration: 240,
    });

    expect(lowPace).toEqual({
      leftPercent: 25,
      timeSecond: 60,
      wpmLabel: "60 wpm",
    });
    expect(highPace).toEqual({
      leftPercent: 75,
      timeSecond: 180,
      wpmLabel: "240 wpm",
    });
  });

  it("keeps neutral waveform labels to the speaker name without a colored emotion", () => {
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
    expect(html).not.toContain('title="Neutral emotion"');
    expect(html).not.toContain("background-color:#94a3b8");
    expect(html).toContain("No emotion signal");
  });

  it("limits waveform emotion colors to hard and chill", () => {
    const html = renderToStaticMarkup(
      <TranscriptViewer
        audioUrl="/api/meetings/11111111-1111-4111-8111-111111111111/audio"
        segments={[
          {
            ...segments[0],
            emotionLabel: "hard",
            id: "segment_hard",
            startMs: 0,
            endMs: 10000,
            text: pacedText,
          },
          {
            ...segments[0],
            emotionLabel: "chill",
            id: "segment_chill",
            startMs: 10000,
            endMs: 20000,
            text: pacedText,
          },
          {
            ...segments[0],
            emotionLabel: "neutral",
            id: "segment_neutral",
            startMs: 20000,
            endMs: 30000,
            text: pacedText,
          },
        ]}
      />,
    );

    expect(html).toContain("background-color:#dc2626");
    expect(html).toContain("background-color:#059669");
    expect(html).not.toContain("background-color:#94a3b8");
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
