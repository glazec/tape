import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { MeetingTranscript } from "@/lib/meeting-queries";
import { MeetingComposedTranscripts } from "@/components/meeting-composed-transcripts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/transcript-viewer", () => ({
  TranscriptViewer: (props: {
    meetingId: string | null;
    segments: { text: string }[];
  }) => (
    <div data-meeting-id={props.meetingId}>
      {props.segments.map((segment) => segment.text).join(" ")}
    </div>
  ),
}));

function meeting(overrides: Partial<MeetingTranscript>): MeetingTranscript {
  return {
    id: "primary",
    title: "Conversation",
    platform: "zoom",
    meetingUrl: "https://zoom.us/j/123",
    status: "ready",
    startedAt: "2026-10-27T15:00:00Z",
    endedAt: "2026-10-27T15:30:00Z",
    updatedAt: "2026-10-27T15:30:00Z",
    durationMs: 1800000,
    transcriptJobStatus: "completed",
    translationLanguage: "en",
    translationSummary: {
      hasTranslations: false,
      status: "not_started",
      totalSegments: 0,
      translatedSegments: 0,
    },
    audioUrl: null,
    recordingParts: [],
    scheduledEndedAt: null,
    scheduledStartedAt: null,
    visualAssets: [],
    segments: [],
    speakerAliases: [],
    speakerSuggestions: [],
    accessScope: "workspace",
    canDelete: true,
    canManage: true,
    accessPeople: [],
    entities: [],
    ...overrides,
  };
}

describe("MeetingComposedTranscripts", () => {
  it("keeps finished text readable while another recording is queued", () => {
    const html = renderToStaticMarkup(
      <MeetingComposedTranscripts
        primaryMeetingId="primary"
        meetings={[
          meeting({
            segments: [
              {
                id: "segment",
                speaker: "Yiping",
                startMs: 0,
                endMs: 1000,
                text: "Earlier conversation",
              },
            ],
          }),
          meeting({
            id: "next",
            title: "Second recording",
            status: "processing",
            transcriptJobStatus: "queued",
          }),
        ]}
      />,
    );
    expect(html).toContain("Earlier conversation");
    expect(html).toContain("Preparing transcript");
    expect(html).toContain('href="/meetings/next"');
    expect(html).not.toContain("No transcript available");
    expect(html).not.toContain("My notes");
  });

  it("binds each editable transcript to its original meeting and honors read only access", () => {
    const segment = {
      id: "s",
      speaker: "Yiping",
      startMs: 0,
      endMs: 1000,
      text: "Source words",
    };
    const html = renderToStaticMarkup(
      <MeetingComposedTranscripts
        primaryMeetingId="primary"
        meetings={[
          meeting({ segments: [segment] }),
          meeting({ id: "source", segments: [{ ...segment, id: "s2" }] }),
          meeting({
            id: "read-only",
            canManage: false,
            segments: [{ ...segment, id: "s3" }],
          }),
        ]}
      />,
    );
    expect(html).toContain('data-meeting-id="primary"');
    expect(html).toContain('data-meeting-id="source"');
    expect(html).not.toContain('data-meeting-id="read-only"');
  });
});
