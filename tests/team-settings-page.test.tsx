import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  getWorkspace,
  getWorkspaceAccessSummary,
  listTeamVocabularyTerms,
  redirect,
  requireCurrentUser,
} = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
  listTeamVocabularyTerms: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  requireCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/auth-guards", () => ({
  requireCurrentUser,
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
  getWorkspaceAccessSummary,
}));

vi.mock("@/lib/team-vocabulary", () => ({
  listTeamVocabularyTerms,
}));

describe("TeamSettingsPage", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    getWorkspaceAccessSummary.mockReset();
    listTeamVocabularyTerms.mockReset();
    redirect.mockClear();
    requireCurrentUser.mockReset();
    vi.resetModules();
  });

  it("redirects shared only users away from creator settings", async () => {
    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "reader@partner.com",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "partner.com",
      canCreateMeetings: false,
    });
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: false,
      hasExternalShares: true,
      hasWorkspaceMeetings: false,
      isSharedOnly: true,
    });

    const { default: TeamSettingsPage } = await import(
      "@/app/settings/team/page"
    );

    await expect(TeamSettingsPage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("shows shared team vocabulary for transcription", async () => {
    requireCurrentUser.mockResolvedValue({
      id: "auth_user_123",
      email: "member@iosg.vc",
      name: "Member",
    });
    getWorkspace.mockResolvedValue({
      userId: "user_123",
      teamId: "team_123",
      domain: "iosg.vc",
      canCreateMeetings: true,
    });
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    listTeamVocabularyTerms.mockResolvedValue([
      {
        id: "term_123",
        term: "TCG platform",
        hint: "trading card game",
        enabled: true,
      },
    ]);

    const { default: TeamSettingsPage } = await import(
      "@/app/settings/team/page"
    );
    const html = renderToStaticMarkup(await TeamSettingsPage());

    expect(html).toContain("Team vocabulary");
    expect(html).toContain("TCG platform");
    expect(html).toContain("Before transcription");
  });
});
