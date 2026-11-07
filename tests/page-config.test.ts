vi.mock("@/lib/user-language", () => ({ getUserLanguage: vi.fn() }));
vi.mock("@/lib/meeting-composition", () => ({ getMeetingCompositionForWorkspace: vi.fn(), composeMeetingForFollowup: vi.fn() }));
vi.mock("@/lib/share-recipient-suggestions", () => ({ listShareRecipientSuggestions: vi.fn() }));
import { describe, expect, it, vi } from "vitest";

import { getTranscriptViewerRenderKey } from "@/lib/meeting-transcript-render-key";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/auth-guards", () => ({
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/lib/calendar-connection-queries", () => ({
  getCalendarConnectionSummaryForWorkspace: vi.fn(),
}));

vi.mock("@/lib/team-vocabulary", () => ({
  listTeamVocabularyTerms: vi.fn(),
}));

vi.mock("@/lib/team-configuration", () => ({
  getTeamConfiguration: vi.fn(),
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
}));

vi.mock("@/lib/meeting-library-views", () => ({
  getDefaultMeetingLibraryView: vi.fn(),
}));

vi.mock("@/lib/onboarding-queries", () => ({
  getOnboardingSetupActivityForWorkspace: vi.fn(),
}));

vi.mock("@/lib/meeting-share-service", () => ({
  listActiveMeetingShares: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
}));

vi.mock("@/lib/organization-workspaces", () => ({}));
vi.mock("@/lib/connected-calendar-accounts", () => ({}));

describe("page rendering configuration", () => {
  it("renders dashboard dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/dashboard/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("renders meeting detail dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/meetings/[meetingId]/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("keeps the meeting transcript mounted while translation and polish progress", () => {
    // Remounting destroys the audio element, so background refreshes must
    // not change the key while someone is listening.
    expect(
      getTranscriptViewerRenderKey({ displayStatus: "ready", meetingId: "meeting_123" }),
    ).toBe(
      getTranscriptViewerRenderKey({ displayStatus: "ready", meetingId: "meeting_123" }),
    );
  });

  it("remounts meeting transcript when display status or meeting changes", () => {
    const baseKey = getTranscriptViewerRenderKey({
      displayStatus: "processing",
      meetingId: "meeting_123",
    });

    expect(
      getTranscriptViewerRenderKey({ displayStatus: "ready", meetingId: "meeting_123" }),
    ).not.toBe(baseKey);
    expect(
      getTranscriptViewerRenderKey({ displayStatus: "processing", meetingId: "meeting_456" }),
    ).not.toBe(baseKey);
  });

  it("renders new meeting dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/meetings/new/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

  it("renders team settings dynamically because it reads auth cookies", async () => {
    const page = await import("@/app/settings/team/page");

    expect(page.dynamic).toBe("force-dynamic");
  });

});
