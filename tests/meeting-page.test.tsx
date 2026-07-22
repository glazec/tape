import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMeeting: vi.fn(),
  getTeamConfiguration: vi.fn(),
  getWorkspace: vi.fn(),
  listRelated: vi.fn(),
  listRecipients: vi.fn(),
  listShares: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  requireUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth-guards", () => ({ requireCurrentUser: mocks.requireUser }));
vi.mock("@/lib/workspace", () => ({ getOrCreateWorkspaceForSessionUser: mocks.getWorkspace }));
vi.mock("@/lib/meeting-queries", () => ({
  getMeetingTranscriptForWorkspace: mocks.getMeeting,
  listMeetingDetailRelatedMeetingsForWorkspace: mocks.listRelated,
  listWorkspaceShareRecipients: mocks.listRecipients,
}));
vi.mock("@/lib/meeting-share-service", () => ({ listActiveMeetingShares: mocks.listShares }));
vi.mock("@/lib/meeting-display-status", () => ({ getMeetingDisplayStatus: ({ meetingStatus }: { meetingStatus: string }) => meetingStatus }));
vi.mock("@/lib/team-configuration", () => ({ getTeamConfiguration: mocks.getTeamConfiguration }));
vi.mock("@/components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/meeting-auto-refresh", () => ({ MeetingAutoRefresh: () => <span>auto refresh</span> }));
vi.mock("@/components/meeting-actions", () => ({ MeetingActions: ({ hasAudio = true, hasTranscript = true, imageCount = 0 }: { hasAudio?: boolean; hasTranscript?: boolean; imageCount?: number }) => <span>meeting actions:{hasAudio || hasTranscript || imageCount > 0 ? "content" : "delete only"}</span> }));
vi.mock("@/components/meeting-entity-links", () => ({ MeetingEntityLinks: () => <span>entity links</span> }));
vi.mock("@/components/meeting-header-metadata", () => ({ MeetingHeaderMetadata: (props: { platform: string; status: string }) => <span>{props.platform}:{props.status}</span> }));
vi.mock("@/components/meeting-recovery-upload-panel", () => ({ MeetingRecoveryUploadPanel: () => <span>recovery panel</span> }));
vi.mock("@/components/meeting-title-editor", () => ({ MeetingTitleEditor: ({ meetingTitle }: { meetingTitle: string }) => <h1>{meetingTitle}</h1> }));
vi.mock("@/components/related-meetings-card", () => ({ RelatedMeetingsCard: () => <span>related meetings</span> }));
vi.mock("@/components/share-dialog", () => ({ ShareDialog: () => <span>share dialog</span> }));
vi.mock("@/components/transcript-viewer", () => ({ TranscriptViewer: ({ meetingId }: { meetingId: string | null }) => <span>transcript:{meetingId ?? "readonly"}</span> }));

import MeetingPage, { getTranscriptViewerRenderKey } from "@/app/meetings/[meetingId]/page";

describe("meeting page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user" });
    mocks.getWorkspace.mockResolvedValue({ canCreateMeetings: true, domain: "iosg.vc", userId: "user" });
    mocks.listRelated.mockResolvedValue([]);
    mocks.listRecipients.mockResolvedValue([]);
    mocks.listShares.mockResolvedValue([]);
    mocks.getTeamConfiguration.mockResolvedValue({ name: "Example Capital", shareAudience: null });
    mocks.getMeeting.mockResolvedValue(meeting());
  });

  it("renders management, sharing, and failed meeting recovery", async () => {
    const html = renderToStaticMarkup(await MeetingPage({ params: Promise.resolve({ meetingId: "meeting_1" }) }));
    expect(html).toContain("meeting actions");
    expect(html).toContain("share dialog");
    expect(html).toContain("recovery panel");
    expect(html).toContain("Google Meet:Failed");
    expect(html).toContain("transcript:meeting_1");
    expect(html).toContain("lg:grid-cols-[1fr_20rem]");
    expect(mocks.listRecipients).toHaveBeenCalled();
  });

  it("offers uploads for scheduled in person meetings", async () => {
    mocks.getMeeting.mockResolvedValue(
      meeting({ platform: "in_person", status: "scheduled" }),
    );

    const html = renderToStaticMarkup(
      await MeetingPage({
        params: Promise.resolve({ meetingId: "in_person_meeting" }),
      }),
    );

    expect(html).toContain("recovery panel");
  });

  it("offers uploads when a manageable meeting has no recording", async () => {
    mocks.getMeeting.mockResolvedValue(
      meeting({
        audioUrl: null,
        segments: [],
        status: "missed",
        visualAssets: [],
      }),
    );

    const html = renderToStaticMarkup(
      await MeetingPage({
        params: Promise.resolve({ meetingId: "missed_meeting" }),
      }),
    );

    expect(html).toContain("recovery panel");
    expect(html).not.toContain("transcript:missed_meeting");
    expect(html).toContain("meeting actions:delete only");
    expect(html).not.toContain("share dialog");
    expect(html).toContain("lg:grid-cols-1");
    expect(html).not.toContain("lg:grid-cols-[1fr_20rem]");
  });

  it("does not offer recovery uploads for ready meetings", async () => {
    mocks.getMeeting.mockResolvedValue(meeting({ status: "ready" }));

    const html = renderToStaticMarkup(
      await MeetingPage({
        params: Promise.resolve({ meetingId: "ready_meeting" }),
      }),
    );

    expect(html).not.toContain("recovery panel");
  });

  it("keeps an existing transcript visible during failed recovery", async () => {
    const html = renderToStaticMarkup(
      await MeetingPage({
        params: Promise.resolve({ meetingId: "failed_with_transcript" }),
      }),
    );

    expect(html).toContain("transcript:failed_with_transcript");
    expect(html).toContain("recovery panel");
    expect(html).toContain("meeting actions:content");
  });

  it("renders shared meetings without owner controls", async () => {
    mocks.getMeeting.mockResolvedValue(meeting({ canManage: false, platform: "in_person", status: "missed" }));
    const html = renderToStaticMarkup(await MeetingPage({ params: Promise.resolve({ meetingId: "meeting_2" }) }));
    expect(html).toContain("Shared transcript");
    expect(html).toContain("In person:No recording");
    expect(html).toContain("transcript:readonly");
    expect(html).not.toContain("meeting actions");
    expect(html).not.toContain("recovery panel");
    expect(mocks.listRecipients).not.toHaveBeenCalled();
  });

  it("does not offer uploads for an empty shared meeting", async () => {
    mocks.getMeeting.mockResolvedValue(
      meeting({
        audioUrl: null,
        canManage: false,
        segments: [],
        status: "missed",
        visualAssets: [],
      }),
    );

    const html = renderToStaticMarkup(
      await MeetingPage({
        params: Promise.resolve({ meetingId: "empty_shared_meeting" }),
      }),
    );

    expect(html).not.toContain("recovery panel");
    expect(html).toContain("transcript:readonly");
  });

  it("formats Zoom and uploaded meetings", async () => {
    mocks.getMeeting.mockResolvedValue(meeting({ platform: "zoom", status: "completed" }));
    expect(renderToStaticMarkup(await MeetingPage({ params: Promise.resolve({ meetingId: "zoom" }) }))).toContain("Zoom:Completed");
    mocks.getMeeting.mockResolvedValue(meeting({ platform: "other", status: "processing" }));
    expect(renderToStaticMarkup(await MeetingPage({ params: Promise.resolve({ meetingId: "upload" }) }))).toContain("Upload:Processing");
  });

  it("delegates missing meetings to notFound", async () => {
    mocks.getMeeting.mockResolvedValue(null);
    await expect(MeetingPage({ params: Promise.resolve({ meetingId: "missing" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("builds a render key from all transcript changing fields", () => {
    expect(getTranscriptViewerRenderKey({
      displayStatus: "completed",
      meetingId: "meeting",
      polishedSegments: 2,
      segmentCount: 3,
      translatedSegments: 1,
      translationStatus: null,
    })).toBe("meeting:completed:3:2:unknown:1");
  });
});

function meeting(overrides: Record<string, unknown> = {}) {
  return {
    accessPeople: [],
    audioUrl: "/audio",
    canManage: true,
    durationMs: 60_000,
    endedAt: new Date("2026-07-20T10:01:00Z"),
    entities: [],
    platform: "google_meet",
    segments: [{ id: "seg", speaker: "Alice", startMs: 0, endMs: 1000, text: "Hello", polishedText: "Hello" }],
    speakerAliases: [],
    speakerSuggestions: [],
    startedAt: new Date("2026-07-20T10:00:00Z"),
    status: "failed",
    title: "Weekly meeting",
    transcriptJobStatus: "failed",
    translationSummary: { hasTranslations: false, status: "not_started", totalSegments: 1, translatedSegments: 0 },
    visualAssets: [{ id: "img", capturedAt: null, timestampMs: 0, url: "/img" }],
    ...overrides,
  };
}
