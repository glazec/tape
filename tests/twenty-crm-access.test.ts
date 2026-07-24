import { afterEach, describe, expect, it, vi } from "vitest";

const { select } = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { select },
}));

describe("Twenty CRM team access", () => {
  afterEach(() => {
    select.mockReset();
    vi.resetModules();
  });

  it.each([
    ["allows the team owning iosg.vc", [{ id: "domain_123" }], true],
    ["rejects every other team", [], false],
  ])("%s", async (_name, rows, expected) => {
    const limit = vi.fn().mockResolvedValue(rows);
    select.mockReturnValue({
      from: () => ({
        where: () => ({ limit }),
      }),
    });

    const { isTwentyCrmTeam } = await import("@/lib/twenty-crm-access");

    await expect(
      isTwentyCrmTeam("11111111-1111-4111-8111-111111111111"),
    ).resolves.toBe(expected);
  });
});
