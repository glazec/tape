import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getProviderUsageSummary,
  getWorkspace,
  getWorkspaceAccessSummary,
  redirect,
  requireCurrentUser,
} = vi.hoisted(() => ({
  getProviderUsageSummary: vi.fn(),
  getWorkspace: vi.fn(),
  getWorkspaceAccessSummary: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  requireCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/components/local-date-time", () => ({
  LocalDateTime: ({ value }: { value: string }) => <time>{value}</time>,
}));

vi.mock("@/lib/auth-guards", () => ({
  requireCurrentUser,
}));

vi.mock("@/lib/provider-usage", () => ({
  ELEVENLABS_ENTITY_DETECTION_USD_MICROS_PER_HOUR: 70_000,
  ELEVENLABS_KEYTERM_PROMPTING_USD_MICROS_PER_HOUR: 50_000,
  ELEVENLABS_SCRIBE_USD_MICROS_PER_HOUR: 220_000,
  PROVIDER_PRICING_SNAPSHOT_DATE: "2026-07-23",
  RECALL_RECORDING_USD_MICROS_PER_HOUR: 500_000,
  providerPricingSources: {
    elevenlabs: "https://elevenlabs.example/pricing",
    openrouter: "https://openrouter.example/usage",
    recall: "https://recall.example/pricing",
  },
}));

vi.mock("@/lib/provider-usage-queries", () => ({
  formatUsdMicros: (value: number) => `$${(value / 1_000_000).toFixed(2)}`,
  getCreditUsagePercent: ({
    limitUsdMicros,
    usedUsdMicros,
  }: {
    limitUsdMicros: number | null;
    usedUsdMicros: number;
  }) =>
    limitUsdMicros && limitUsdMicros > 0
      ? Math.min(100, (usedUsdMicros / limitUsdMicros) * 100)
      : 0,
  getProviderUsagePeriodLabel: (period: string) =>
    period === "last_90_days" ? "Last 90 days" : "July 2026",
  getProviderUsageSummary,
  normalizeProviderUsagePeriod: (value?: string) =>
    value === "last_90_days" ? value : "current_month",
  providerUsageCategoryLabels: {
    recording: "Meeting recording",
    translation: "Translation",
  },
  providerUsagePeriodOptions: [
    { label: "This month", value: "current_month" },
    { label: "Last month", value: "previous_month" },
    { label: "Last 90 days", value: "last_90_days" },
    { label: "All time", value: "all_time" },
  ],
}));

vi.mock("@/lib/workspace", () => ({
  getOrCreateWorkspaceForSessionUser: getWorkspace,
  getWorkspaceAccessSummary,
}));

describe("UsagePage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("renders personal and organization costs for workspace members", async () => {
    requireCurrentUser.mockResolvedValue({
      email: "member@example.com",
      id: "auth_user_123",
      name: "Member",
    });
    const workspace = {
      canCreateMeetings: true,
      domain: "example.com",
      teamId: "team_123",
      teamName: "Example Capital",
      userId: "user_123",
    };
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    getProviderUsageSummary.mockResolvedValue({
      breakdown: [
        { category: "recording", costUsdMicros: 3_000_000 },
        { category: "translation", costUsdMicros: 2_000_000 },
      ],
      creditLimitUsdMicros: 20_000_000,
      creditRemainingUsdMicros: 12_000_000,
      isCreditExhausted: false,
      organizationAllTimeUsdMicros: 8_000_000,
      organizationPeriodUsdMicros: 5_000_000,
      personalAllTimeUsdMicros: 2_500_000,
      personalPeriodUsdMicros: 1_250_000,
      recentPersonalUsage: [
        {
          category: "translation",
          costSource: "provider_reported",
          costUsdMicros: 250_000,
          historicalEstimate: false,
          meetingId: "meeting_123",
          meetingTitle: "Customer diligence",
          occurredAt: "2026-07-23T15:00:00.000Z",
          provider: "openrouter",
        },
      ],
      trackedSince: "2026-07-01T12:00:00.000Z",
    });

    const { default: UsagePage } = await import("@/app/usage/page");
    const html = renderToStaticMarkup(await UsagePage());

    expect(getProviderUsageSummary).toHaveBeenCalledWith(
      workspace,
      "current_month",
    );
    expect(html).toContain("Billing &amp; credits");
    expect(html).toContain("Credit remaining");
    expect(html).toContain("$12.00");
    expect(html).toContain("$1.25");
    expect(html).toContain("$5.00");
    expect(html).toContain("Consumption by service");
    expect(html).toContain("Customer diligence");
    expect(html).toContain("Provider reported");
    expect(html).toContain("Last 90 days");
  });

  it("labels reconstructed recording history as an estimate", async () => {
    requireCurrentUser.mockResolvedValue({
      email: "member@example.com",
      id: "auth_user_123",
      name: "Member",
    });
    const workspace = {
      canCreateMeetings: true,
      domain: "example.com",
      teamId: "team_123",
      userId: "user_123",
    };
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    getProviderUsageSummary.mockResolvedValue({
      breakdown: [],
      creditLimitUsdMicros: null,
      creditRemainingUsdMicros: null,
      isCreditExhausted: false,
      organizationAllTimeUsdMicros: 1_000_000,
      organizationPeriodUsdMicros: 1_000_000,
      personalAllTimeUsdMicros: 1_000_000,
      personalPeriodUsdMicros: 1_000_000,
      recentPersonalUsage: [
        {
          category: "recording",
          costSource: "published_rate",
          costUsdMicros: 1_000_000,
          historicalEstimate: true,
          meetingId: "meeting_123",
          meetingTitle: "Historical meeting",
          occurredAt: "2026-06-23T15:00:00.000Z",
          provider: "recall",
        },
      ],
      trackedSince: "2026-06-23T15:00:00.000Z",
    });

    const { default: UsagePage } = await import("@/app/usage/page");
    const html = renderToStaticMarkup(await UsagePage());

    expect(html).toContain("Historical estimate");
    expect(html).toContain("reconstruct missing Recall recording usage");
  });

  it("uses the selected billing period", async () => {
    requireCurrentUser.mockResolvedValue({
      email: "member@example.com",
      id: "auth_user_123",
      name: "Member",
    });
    const workspace = {
      canCreateMeetings: true,
      domain: "example.com",
      teamId: "team_123",
      userId: "user_123",
    };
    getWorkspace.mockResolvedValue(workspace);
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: true,
      hasExternalShares: false,
      hasWorkspaceMeetings: true,
      isSharedOnly: false,
    });
    getProviderUsageSummary.mockResolvedValue({
      breakdown: [],
      creditLimitUsdMicros: null,
      creditRemainingUsdMicros: null,
      isCreditExhausted: false,
      organizationAllTimeUsdMicros: 8_000_000,
      organizationPeriodUsdMicros: 7_000_000,
      personalAllTimeUsdMicros: 2_500_000,
      personalPeriodUsdMicros: 2_000_000,
      recentPersonalUsage: [],
      trackedSince: null,
    });

    const { default: UsagePage } = await import("@/app/usage/page");
    const html = renderToStaticMarkup(
      await UsagePage({
        searchParams: Promise.resolve({ period: "last_90_days" }),
      }),
    );

    expect(getProviderUsageSummary).toHaveBeenCalledWith(
      workspace,
      "last_90_days",
    );
    expect(html).toContain("Last 90 days");
    expect(html).toContain("No limit");
  });

  it("redirects shared only users before querying provider usage", async () => {
    requireCurrentUser.mockResolvedValue({
      email: "reader@partner.com",
      id: "auth_user_456",
      name: null,
    });
    getWorkspace.mockResolvedValue({
      canCreateMeetings: false,
      domain: "partner.com",
      teamId: "team_456",
      userId: "user_456",
    });
    getWorkspaceAccessSummary.mockResolvedValue({
      canCreateMeetings: false,
      hasExternalShares: true,
      hasWorkspaceMeetings: false,
      isSharedOnly: true,
    });

    const { default: UsagePage } = await import("@/app/usage/page");

    await expect(UsagePage()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(getProviderUsageSummary).not.toHaveBeenCalled();
  });
});
