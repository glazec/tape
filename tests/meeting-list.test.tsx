import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MeetingList } from "@/components/meeting-list";

describe("MeetingList", () => {
  it("defers Started formatting to the browser timezone", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Customer sync",
            platform: "google_meet",
            startedAt: "2026-01-01T12:00:00.000Z",
            status: "ready",
          },
        ]}
      />,
    );

    expect(html).toContain('dateTime="2026-01-01T12:00:00.000Z"');
  });

  it("renders a custom empty message for shared transcript readers", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        emptyMessage="No transcripts have been shared with you yet"
        meetings={[]}
      />,
    );

    expect(html).toContain("No transcripts have been shared with you yet");
    expect(html).not.toContain("No meetings found");
  });

  it("shows related meetings as a compact tree under the main meeting", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "Nascent follow up",
            platform: "google_meet",
            startedAt: "2026-06-27T12:00:00.000Z",
            status: "ready",
            relatedMeetings: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Nascent intro",
                startedAt: "2026-06-20T12:00:00.000Z",
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Nascent follow up");
    expect(html).toContain("Nascent intro");
    expect(html).toContain("Related");
  });

  it("shows uploaded queued audio as in progress", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "33333333-3333-4333-8333-333333333333",
            title: "Investment review",
            platform: "upload",
            startedAt: "2026-06-27T12:00:00.000Z",
            status: "processing",
            transcriptJobStatus: "queued",
          },
        ]}
      />,
    );

    expect(html).toContain("Investment review");
    expect(html).toContain("In progress");
    expect(html).not.toContain("Queued");
  });
});
