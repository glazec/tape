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
            durationMs: 12 * 60 * 1000,
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
    expect(html).toContain("12m");
    expect(html).not.toContain("1h 30m");
    expect(html).toContain("pl-8");
    expect(html).toContain("w-28 text-center");
  });

  it("uses planned duration only for an upcoming scheduled meeting", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Upcoming sync",
            platform: "zoom",
            startedAt: "2999-01-01T12:00:00.000Z",
            endedAt: "2999-01-01T13:30:00.000Z",
            status: "scheduled",
          },
        ]}
      />,
    );

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

    expect(html).toContain("24m");
    expect(html).not.toContain("Unknown");
  });

  it("shows completed minutes for the recovered 42 minute meeting", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Finance discussion",
            platform: "zoom",
            startedAt: "2026-07-22T17:21:27.499Z",
            endedAt: "2026-07-22T18:04:18.857Z",
            durationMs: 2_571_358,
            status: "ready",
          },
        ]}
      />,
    );

    expect(html).toContain("42m");
    expect(html).not.toContain("43m");
  });

  it("shows participant names from the people value", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Customer sync",
            platform: "google_meet",
            startedAt: "2026-01-01T12:00:00.000Z",
            participantCount: 2,
            participantNames: ["Alice Chen", "Bob Li"],
            status: "scheduled",
          },
        ]}
      />,
    );

    expect(html).toContain("2 people");
    expect(html).toContain("Alice Chen");
    expect(html).toContain("Bob Li");
    expect(html).toContain("Participants: Alice Chen, Bob Li");
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

  it("expands related meetings by default", () => {
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
    expect(html).not.toContain("Detected entity");
    expect(html).toContain("1 related");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Collapse Nascent follow up"');
  });

  it("shows a clear button to search older related meetings", () => {
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
            hasMoreRelatedMeetings: true,
            relatedHistoryHref: "/dashboard?relatedMonths=12",
            relatedHistoryMonths: 6,
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

    expect(html).toContain("1 related");
    expect(html).toContain("Load older related");
    expect(html).toContain("Search before last 6 months");
    expect(html).toContain('href="/dashboard?relatedMonths=12"');
  });

  it("shows grouped row status and expanded related count", () => {
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
    expect(html).toContain('data-variant="secondary"');
    expect(html).toContain("David &lt;&gt; YP");
    expect(html).toContain("size-5 shrink-0");
    expect(html).toContain("items-start gap-1 relative pl-8");
    expect(html).not.toContain("rounded-full bg-muted-foreground/40");
    expect(html).not.toContain("bg-muted/20");
    expect(html).not.toContain("has-aria-expanded:bg-muted/50");
  });

  it("turns an upcoming scheduled status into a join now action", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            title: "Partner call",
            platform: "zoom",
            startedAt: "2999-06-29T15:00:00.000Z",
            status: "scheduled",
            hasRecallBot: true,
          },
        ]}
      />,
    );

    expect(html).toContain("Join now");
    expect(html).toContain("Join Partner call now");
    expect(html).toContain(
      "/api/meetings/22222222-2222-4222-8222-222222222222/join",
    );

    const joinButton = html.match(
      /<button[^>]*aria-label="Join Partner call now"[^>]*>[\s\S]*?<\/button>/,
    )?.[0];

    expect(joinButton).toBeDefined();
    expect(joinButton).toContain("h-5 w-[5.625rem]");
    expect(joinButton).toContain("rounded-4xl");
    expect(joinButton).toContain("border-primary");
    expect(joinButton).toContain("text-primary");
    expect(joinButton).toContain("meeting-join-action");
    expect(joinButton).toContain('aria-busy="false"');
    expect(joinButton).toContain("Join now");
    expect(html).toContain("meeting-join-badge");
    expect(html).toContain(
      "inline-grid w-[5.625rem] items-center justify-items-center",
    );
    expect(html).toContain("Scheduled");
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

  it("shows a missed bot join as no recording without review copy", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "44444444-4444-4444-8444-444444444444",
            title: "Partner sync",
            platform: "zoom",
            startedAt: "2026-06-27T12:00:00.000Z",
            status: "missed",
            hasRecallBot: true,
          },
        ]}
      />,
    );

    expect(html).toContain("Partner sync");
    expect(html).toContain("No recording");
    expect(html).toContain("Bot did not join");
    expect(html).toContain(
      "text-muted-foreground hover:text-foreground",
    );
    expect(html).not.toContain("Needs review");
    expect(html).not.toContain("Failed");
  });

  it("dims failed meeting copy while preserving the error status", () => {
    const html = renderToStaticMarkup(
      <MeetingList
        meetings={[
          {
            id: "55555555-5555-4555-8555-555555555555",
            title: "Failed upload",
            platform: "upload",
            startedAt: "2026-06-27T12:00:00.000Z",
            status: "failed",
          },
        ]}
      />,
    );

    expect(html).toContain("Failed upload");
    expect(html).toContain("Needs review");
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain(
      "text-muted-foreground hover:text-foreground",
    );
    expect(html).not.toContain("text-xs text-destructive");
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
