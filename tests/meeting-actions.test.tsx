import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MeetingActions } from "@/components/meeting-actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe("MeetingActions", () => {
  it("renders a single export dropdown with transcript and MP3 choices", () => {
    const html = renderToStaticMarkup(
      <MeetingActions meetingId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(html).toContain("Export");
    expect(html).toContain("Transcript");
    expect(html).toContain("MP3");
    expect(html).toContain("Download selected");
    expect(html).not.toContain("Export text");
    expect(html).not.toContain("Export MP3");
    expect(html).not.toContain("Export all");
    expect(html).toContain("Copy");
    expect(html).toContain("Delete");
  });

  it("does not show transcript language choices", () => {
    const html = renderToStaticMarkup(
      <MeetingActions meetingId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(html).not.toContain("Transcript language");
    expect(html).not.toContain("中文");
    expect(html).not.toContain("language=");
  });

  it("shows only delete when the meeting has no content", () => {
    const html = renderToStaticMarkup(
      <MeetingActions
        hasAudio={false}
        hasTranscript={false}
        meetingId="11111111-1111-4111-8111-111111111111"
      />,
    );

    expect(html).not.toContain("Export");
    expect(html).not.toContain("Copy");
    expect(html).toContain('aria-label="More meeting actions"');
    expect(html).toContain("Delete meeting");
  });

  it("offers only actions backed by available meeting content", () => {
    const audioOnly = renderToStaticMarkup(
      <MeetingActions
        hasTranscript={false}
        meetingId="11111111-1111-4111-8111-111111111111"
      />,
    );
    const transcriptOnly = renderToStaticMarkup(
      <MeetingActions
        hasAudio={false}
        meetingId="11111111-1111-4111-8111-111111111111"
      />,
    );

    expect(audioOnly).toContain("MP3");
    expect(audioOnly).not.toContain("Copy");
    expect(audioOnly).not.toContain(">Transcript<");
    expect(transcriptOnly).toContain(">Transcript<");
    expect(transcriptOnly).toContain("Copy");
    expect(transcriptOnly).not.toContain("MP3");
  });
});
