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
            endedAt: "2026-01-01T13:30:00.000Z",
            participantCount: 3,
            status: "ready",
          },
        ]}
      />,
    );

    expect(html).toContain('dateTime="2026-01-01T12:00:00.000Z"');
    expect(html).toContain("Participants");
    expect(html).toContain("Duration");
    expect(html).toContain("3 people");
    expect(html).toContain("1h 30m");
  });

  it("uses transcript timing when a meeting end time is missing", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Uploaded audio",
            platform: "upload",
            startedAt: "2026-01-01T12:00:00.000Z",
            durationMs: 1_478_342,
            participantCount: 2,
            status: "ready",
          },
        ]}
      />,
    );

    expect(html).toContain("25m");
    expect(html).not.toContain("Unknown");
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

  it("shows related meetings expanded by default", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "Nascent follow up",
            platform: "google_meet",
            primaryEntity: "nascent",
            startedAt: "2026-06-27T12:00:00.000Z",
            status: "ready",
            relatedMeetings: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "Nascent intro",
                platform: "google_meet",
                startedAt: "2026-06-20T12:00:00.000Z",
                status: "ready",
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Nascent follow up");
    expect(html).toContain("Nascent intro");
    expect(html).toContain("Detected entity");
    expect(html).toContain("Nascent");
    expect(html).toContain("1 related");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Collapse Nascent follow up"');
  });

  it("shows grouped row status and collapsed related count", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "David <> YP",
            platform: "zoom",
            startedAt: "2999-06-29T15:00:00.000Z",
            status: "scheduled",
            relatedMeetings: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                title: "David <> YP",
                platform: "zoom",
                startedAt: "2026-06-27T10:00:00.000Z",
                status: "ready",
              },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Scheduled");
    expect(html).toContain("1 related");
    expect(html).toContain("Ready");
    expect(html).toContain("David &lt;&gt; YP");
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

  it("renders sortable headers for meeting name, participants, duration, and time", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[]}
        sort="duration_desc"
        sortLinks={{
          title: "/dashboard?sort=title_asc",
          participantCount: "/dashboard?sort=participants_desc",
          duration: "/dashboard?sort=duration_desc",
          startedAt: "/dashboard?sort=time_desc",
        }}
      />,
    );

    expect(html).toContain('href="/dashboard?sort=title_asc"');
    expect(html).toContain('href="/dashboard?sort=participants_desc"');
    expect(html).toContain('href="/dashboard?sort=duration_desc"');
    expect(html).toContain('href="/dashboard?sort=time_desc"');
    expect(html).toContain('aria-sort="descending"');
  });
});
