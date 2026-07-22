import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  canManageTeamSettings,
  getWorkspace,
  getWorkspaceAccessSummary,
  getDefaultMeetingBotAvatarJpegBase64,
  getMeetingBotProfile,
  getTeamConfiguration,
  listTeamVocabularyTerms,
  listWorkspaceMembers,
  redirect,
  requireCurrentUser,
} = vi.hoisted(() => ({
  canManageTeamSettings: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
  getDefaultMeetingBotAvatarJpegBase64: vi.fn(),
  getMeetingBotProfile: vi.fn(),
  getTeamConfiguration: vi.fn(),
  listTeamVocabularyTerms: vi.fn(),
  listWorkspaceMembers: vi.fn(),
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
  canManageTeamSettings,
  getOrCreateWorkspaceForSessionUser: getWorkspace,
  getWorkspaceAccessSummary,
  listWorkspaceMembers,
}));

vi.mock("@/lib/team-vocabulary", () => ({
  listTeamVocabularyTerms,
}));

vi.mock("@/lib/meeting-bot-profile", () => ({
  getDefaultMeetingBotAvatarJpegBase64,
  getMeetingBotProfile,
}));

vi.mock("@/lib/team-configuration", () => ({ getTeamConfiguration }));

describe("TeamSettingsPage", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    canManageTeamSettings.mockReset();
    getWorkspaceAccessSummary.mockReset();
    getDefaultMeetingBotAvatarJpegBase64.mockReset();
    getMeetingBotProfile.mockReset();
    getTeamConfiguration.mockReset();
    listTeamVocabularyTerms.mockReset();
    listWorkspaceMembers.mockReset();
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
    canManageTeamSettings.mockResolvedValue(false);

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
    listWorkspaceMembers.mockResolvedValue([
      {
        email: "member@iosg.vc",
        id: "user_123",
        isCurrentUser: true,
        joinedAt: new Date("2026-06-29T12:00:00.000Z"),
        name: "Member",
        role: "member",
      },
      {
        email: "alice@iosg.vc",
        id: "user_456",
        isCurrentUser: false,
        joinedAt: new Date("2026-06-30T12:00:00.000Z"),
        name: "Alice",
        role: "member",
      },
    ]);
    getMeetingBotProfile.mockResolvedValue({
      botName: "Deal Scribe",
      avatarJpegBase64: "custom-avatar",
    });
    getTeamConfiguration.mockResolvedValue({
      name: "Example Capital",
      shareAudience: {
        emails: ["partner@example.com", "principal@example.com"],
        name: "Investment committee",
      },
    });

    const { default: TeamSettingsPage } = await import(
      "@/app/settings/team/page"
    );
    const html = renderToStaticMarkup(await TeamSettingsPage());

    expect(html).toContain("Team vocabulary");
    expect(html).toContain("Team identity and sharing");
    expect(html).toContain("Example Capital");
    expect(html).toContain("Investment committee");
    expect(html).toContain("2 members");
    expect(html).toContain("TCG platform");
    expect(html).toContain("Before transcription");
    expect(html).toContain("Team meeting bot");
    expect(html).toContain("Team meeting bot avatar");
    expect(html).toContain("Deal Scribe");
    expect(html).toContain("Custom avatar saved");
    expect(html).toContain("Onboarded colleagues");
    expect(html).toContain("Member");
    expect(html).toContain("member@iosg.vc");
    expect(html).toContain("Alice");
    expect(html).toContain("alice@iosg.vc");
    expect(html).toContain("You");
    expect(html).toContain("Only team administrators can edit these settings");
    expect(html).not.toContain('action="/api/team/bot-profile"');
    expect(html).not.toContain('action="/api/team/vocabulary"');
    expect(listWorkspaceMembers).toHaveBeenCalledWith({
      canCreateMeetings: true,
      domain: "iosg.vc",
      teamId: "team_123",
      userId: "user_123",
    });
  });

  it("previews the default bot avatar when no custom avatar is saved", async () => {
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
    canManageTeamSettings.mockResolvedValue(false);
    listTeamVocabularyTerms.mockResolvedValue([]);
    listWorkspaceMembers.mockResolvedValue([]);
    getMeetingBotProfile.mockResolvedValue({
      botName: "IOSG Old Friends",
      avatarJpegBase64: null,
    });
    getTeamConfiguration.mockResolvedValue({
      name: "Example Capital",
      shareAudience: null,
    });
    getDefaultMeetingBotAvatarJpegBase64.mockReturnValue("default-avatar");

    const { default: TeamSettingsPage } = await import(
      "@/app/settings/team/page"
    );
    const html = renderToStaticMarkup(await TeamSettingsPage());

    expect(html).toContain("Default avatar");
    expect(html).toContain("data:image/jpeg;base64,default-avatar");
  });
});
