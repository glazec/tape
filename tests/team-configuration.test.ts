import { afterEach, describe, expect, it, vi } from "vitest";

const { select, set, update, where } = vi.hoisted(() => ({
  select: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select, update },
}));

describe("team configuration", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it("reads a configured sharing audience", async () => {
    select.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: vi.fn().mockResolvedValue([
            {
              name: "Example Capital",
              shareAudienceEmails: [
                "PARTNER@example.com",
                "partner@example.com",
                "principal@example.com",
              ],
              shareAudienceName: "Investment committee",
            },
          ]),
        }),
      }),
    });

    const { getTeamConfiguration } = await import("@/lib/team-configuration");

    await expect(getTeamConfiguration("team_123")).resolves.toEqual({
      name: "Example Capital",
      shareAudience: {
        emails: ["partner@example.com", "principal@example.com"],
        name: "Investment committee",
      },
    });
  });

  it("normalizes and saves team settings", async () => {
    update.mockReturnValue({ set });
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
    const { updateTeamConfiguration } = await import(
      "@/lib/team-configuration"
    );

    await updateTeamConfiguration({
      name: " Example   Capital ",
      shareAudienceEmails:
        "Partner@Example.com\nprincipal@example.com,partner@example.com",
      shareAudienceName: " Investment   committee ",
      teamId: "team_123",
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Example Capital",
        shareAudienceEmails: [
          "partner@example.com",
          "principal@example.com",
        ],
        shareAudienceName: "Investment committee",
      }),
    );
  });

  it("requires a sharing group name and emails together", async () => {
    const { updateTeamConfiguration } = await import(
      "@/lib/team-configuration"
    );

    await expect(
      updateTeamConfiguration({
        name: "Example Capital",
        shareAudienceEmails: "partner@example.com",
        shareAudienceName: "",
        teamId: "team_123",
      }),
    ).rejects.toThrow(
      "Sharing group name and member emails must be provided together",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects sharing group names that collide with built in recipients", async () => {
    const { updateTeamConfiguration } = await import(
      "@/lib/team-configuration"
    );

    await expect(
      updateTeamConfiguration({
        name: "Example Capital",
        shareAudienceEmails: "partner@example.com",
        shareAudienceName: "Whole organization",
        teamId: "team_123",
      }),
    ).rejects.toThrow(
      "Sharing group name must be different from Whole organization",
    );
    expect(update).not.toHaveBeenCalled();
  });
});
