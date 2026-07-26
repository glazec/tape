import { afterEach, describe, expect, it, vi } from "vitest";

const { select } = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    select,
  },
}));

describe("onboarding setup activity", () => {
  afterEach(() => {
    select.mockReset();
    vi.resetModules();
  });

  it("finds authenticated desktop app and MCP activity", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ id: "device_123" }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([{ id: "event_123" }]),
          }),
        }),
      });

    const { getOnboardingSetupActivityForWorkspace } = await import(
      "@/lib/onboarding-queries"
    );

    await expect(
      getOnboardingSetupActivityForWorkspace({
        canCreateMeetings: true,
        domain: "example.com",
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual({
      desktopAppConnected: true,
      mcpUsed: true,
    });
  });

  it("keeps incomplete activity visible", async () => {
    select
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    const { getOnboardingSetupActivityForWorkspace } = await import(
      "@/lib/onboarding-queries"
    );

    await expect(
      getOnboardingSetupActivityForWorkspace({
        canCreateMeetings: true,
        domain: "example.com",
        teamId: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual({
      desktopAppConnected: false,
      mcpUsed: false,
    });
  });
});
