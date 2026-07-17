import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/auth-guards", () => ({
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/lib/calendar-connection-queries", () => ({
  getCalendarConnectionSummaryForWorkspace: vi.fn(),
}));

vi.mock("@/lib/share-links", () => ({
  getSharedTranscriptByToken: vi.fn(),
}));

vi.mock("@/lib/team-vocabulary", () => ({
  listTeamVocabularyTerms: vi.fn(),
}));

vi.mock("@/lib/meeting-bot-profile", () => ({
  getMeetingBotProfile: vi.fn(),
}));

vi.mock("@/lib/meeting-queries", () => ({
  getMeetingTranscriptForWorkspace: vi.fn(),
  getWorkspaceMeetingTranscript: vi.fn(),
  listMeetingDetailRelatedMeetingsForWorkspace: vi.fn(),
  listMeetingLibraryPageForWorkspace: vi.fn(),
  listMeetingsForWorkspace: vi.fn(),
  listWorkspaceShareRecipients: vi.fn(),
  listWorkspaceMeetings: vi.fn(),
}));

vi.mock("@/lib/meeting-library-views", () => ({
  getDefaultMeetingLibraryView: vi.fn(),
}));

vi.mock("@/lib/meeting-share-service", () => ({
  listActiveMeetingShares: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
}));

describe("page rendering configuration", () => {
  it("renders dashboard dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/dashboard/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("renders meeting detail dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/meetings/[meetingId]/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("remounts meeting transcript when translation progress changes", async () => {
    const page = await import("@/app/meetings/[meetingId]/page");
    const baseKey = page.getTranscriptViewerRenderKey({
      displayStatus: "ready",
      meetingId: "meeting_123",
      polishedSegments: 0,
      segmentCount: 3,
      translatedSegments: 0,
      translationStatus: "running",
    });

    expect(
      page.getTranscriptViewerRenderKey({
        displayStatus: "ready",
        meetingId: "meeting_123",
        polishedSegments: 0,
        segmentCount: 3,
        translatedSegments: 1,
        translationStatus: "running",
      }),
    ).not.toBe(baseKey);
    expect(
      page.getTranscriptViewerRenderKey({
        displayStatus: "ready",
        meetingId: "meeting_123",
        polishedSegments: 0,
        segmentCount: 3,
        translatedSegments: 1,
        translationStatus: "completed",
      }),
    ).not.toBe(baseKey);
  });

  it("remounts meeting transcript when original polish progress changes", async () => {
    const page = await import("@/app/meetings/[meetingId]/page");

    expect(
      page.getTranscriptViewerRenderKey({
        displayStatus: "ready",
        meetingId: "meeting_123",
        polishedSegments: 1,
        segmentCount: 3,
        translatedSegments: 0,
        translationStatus: "not_needed",
      }),
    ).not.toBe(
      page.getTranscriptViewerRenderKey({
        displayStatus: "ready",
        meetingId: "meeting_123",
        polishedSegments: 0,
        segmentCount: 3,
        translatedSegments: 0,
        translationStatus: "not_needed",
      }),
    );
  });

  it("renders new meeting dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/meetings/new/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("renders team settings dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/settings/team/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("renders share pages dynamically because share tokens can expire or be revoked", async () => {
    const page = await import("@/app/share/[token]/page");

    expect(page.dynamic).toBe("force-dynamic");
  });
});
