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
});
