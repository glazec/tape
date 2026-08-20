import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  canManageTeamSettings,
  getProviderBillingOverview,
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
  getProviderBillingOverview: vi.fn(),
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

vi.mock("@/lib/provider-usage-queries", () => ({
  formatUsdMicros: (value: number) => `$${(value / 1_000_000).toFixed(2)}`,
  getProviderBillingOverview,
}));

describe("TeamSettingsPage", () => {
  afterEach(() => {
    getWorkspace.mockReset();
    canManageTeamSettings.mockReset();
    getProviderBillingOverview.mockReset();
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

    const { default: TeamSettingsPage } =
      await import("@/app/settings/team/page");

    await expect(TeamSettingsPage()).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
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
      ...Array.from({ length: 7 }, (_, index) => ({
        email: `member${index + 3}@iosg.vc`,
        id: `user_${index + 3}`,
        isCurrentUser: false,
        joinedAt: new Date(`2026-07-0${index + 1}T12:00:00.000Z`),
        name: index === 0 ? "Momir Amidzic" : `Member ${index + 3}`,
        role: "member",
      })),
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
      translationLanguage: "en",
    });
    getProviderBillingOverview.mockResolvedValue({
      creditLimitUsdMicros: 20_000_000,
      creditRemainingUsdMicros: 12_000_000,
      isCreditExhausted: false,
      organizationMonthUsdMicros: 5_000_000,
      personalMonthUsdMicros: 1_250_000,
    });

    const { default: TeamSettingsPage } =
      await import("@/app/settings/team/page");
    const html = renderToStaticMarkup(await TeamSettingsPage());

    expect(html).toContain("Transcription vocabulary");
    expect(html).toContain("Workspace defaults");
    expect(html).toContain("Example Capital");
    expect(html).toContain("Investment committee");
    expect(html).toContain("Translations");
    expect(html).toContain("English");
    expect(html).toContain("2 members");
    expect(html).toContain("TCG platform");
    expect(html).toContain("Meeting capture");
    expect(html).toContain("Team meeting bot avatar");
    expect(html).toContain("Deal Scribe");
    expect(html).toContain("Custom avatar saved");
    expect(html).toContain("Workspace members");
    expect(html).toContain("Member");
    expect(html).toContain("member@iosg.vc");
    expect(html).toContain("Alice");
    expect(html).toContain("alice@iosg.vc");
    expect(html).toContain("Momir Amidzic");
    expect(html).toContain("You");
    expect(html).toContain(">9<");
    expect(html).not.toContain("max-h-80");
    expect(html).not.toContain("overflow-y-auto");
    expect(html).toContain("Only team administrators can edit these settings");
    expect(html).toContain("Billing &amp; credits");
    expect(html).toContain("Credit remaining");
    expect(html).toContain("$12.00");
    expect(html).toContain("$5.00");
    expect(html).toContain("$1.25");
    expect(html).toContain('href="/usage"');
    expect(
      html.match(/Only team administrators can edit these settings/g),
    ).toHaveLength(1);
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
    canManageTeamSettings.mockResolvedValue(true);
    listTeamVocabularyTerms.mockResolvedValue([]);
    listWorkspaceMembers.mockResolvedValue([]);
    getMeetingBotProfile.mockResolvedValue({
      botName: "IOSG Old Friends",
      avatarJpegBase64: null,
    });
    getTeamConfiguration.mockResolvedValue({
      name: "Example Capital",
      shareAudience: null,
      translationLanguage: "zh-CN",
    });
    getProviderBillingOverview.mockResolvedValue({
      creditLimitUsdMicros: null,
      creditRemainingUsdMicros: null,
      isCreditExhausted: false,
      organizationMonthUsdMicros: 0,
      personalMonthUsdMicros: 0,
    });
    getDefaultMeetingBotAvatarJpegBase64.mockReturnValue("default-avatar");

    const { default: TeamSettingsPage } =
      await import("@/app/settings/team/page");
    const html = renderToStaticMarkup(await TeamSettingsPage());

    expect(html).toContain("Default avatar");
    expect(html).toContain("data:image/jpeg;base64,default-avatar");
    expect(html).toContain("Translate transcripts to");
    expect(html).toContain("Simplified Chinese");
    expect(html).toContain('name="translationLanguage"');
    expect(html).toContain("No limit");
  });
});
