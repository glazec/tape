import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RelatedMeetingsCard } from "@/components/related-meetings-card";

describe("RelatedMeetingsCard", () => {
  it("shows related meeting links, start times, and transcript previews", () => {
    const html = renderToStaticMarkup(
      <RelatedMeetingsCard
        meetings={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Nascent intro",
            startedAt: "2026-06-20T12:00:00.000Z",
            hasMoreTranscriptSegments: true,
            transcriptPreview: [
              {
                id: "segment_1",
                speaker: "Founder",
                startMs: 42_000,
                text: "We discussed the next product milestone.",
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Related meetings");
    expect(html).toContain("Nascent intro");
    expect(html).toContain(
      'href="/meetings/11111111-1111-4111-8111-111111111111"',
    );
    expect(html).toContain("Started");
    expect(html).toContain('dateTime="2026-06-20T12:00:00.000Z"');
    expect(html).toContain("Founder");
    expect(html).toContain("0:42");
    expect(html).toContain("We discussed the next product milestone.");
    expect(html).toContain("max-h-80");
    expect(html).toContain("lg:max-h-48");
    expect(html).toContain("overflow-visible");
    expect(html).toContain("lg:right-full");
    expect(html).toContain("lg:bottom-0");
    expect(html).toContain("Open the meeting for the full transcript.");
  });
});
