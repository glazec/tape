import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MeetingComposedTranscripts } from "@/components/meeting-composed-transcripts";
import { TranscriptViewer } from "@/components/transcript-viewer";
import type { MeetingTranscript } from "@/lib/meeting-queries";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
function part(id: string): MeetingTranscript {
  return {
    id, title: id, platform: "zoom", status: "ready", meetingUrl: null,
    startedAt: null, endedAt: null, updatedAt: "2026-10-28T12:00:00Z", durationMs: 1000,
    transcriptJobStatus: "completed", audioUrl: `/audio/${id}`, recordingParts: [],
    segments: [{ id: `segment-${id}`, speaker: "Alice", text: `Words ${id}`, startMs: 0, endMs: 1000 }],
    speakerAliases: [], speakerSuggestions: [], visualAssets: [], translationLanguage: "en",
    translationSummary: { status: "not_started", totalSegments: 1, translatedSegments: 0, hasTranslations: false },
    canManage: true, canDelete: true, accessScope: "workspace", accessPeople: [], entities: [],
    scheduledStartedAt: null, scheduledEndedAt: null,
  };
}
describe("combined meeting playback", () => {
  it("keeps every recording's controls beside that transcript without overlapping fixed players", () => {
    const html = renderToStaticMarkup(<MeetingComposedTranscripts primaryMeetingId="a" meetings={[part("a"), part("b")]} />);
    expect(html.match(/aria-label="Play audio"/g)).toHaveLength(2);
    expect(html).toContain('src="/audio/a"');
    expect(html).toContain('src="/audio/b"');
    expect(html).not.toContain("fixed inset-x-0 bottom-0");
  });
  it("retains the fixed player on a single transcript", () => {
    const meeting = part("a");
    const html = renderToStaticMarkup(<TranscriptViewer segments={meeting.segments} audioUrl={meeting.audioUrl} />);
    expect(html).toContain("fixed inset-x-0 bottom-0");
  });
  it("shows waiting for admission in a source recording", () => {
    const source = { ...part("b"), status: "recording" as const, botState: "waiting_room", segments: [] };
    const html = renderToStaticMarkup(<MeetingComposedTranscripts primaryMeetingId="a" meetings={[part("a"), source]} />);
    expect(html).toContain("In waiting room");
    expect(html).not.toContain("Recording in progress");
  });
});
