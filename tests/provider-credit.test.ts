import { afterEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();

vi.mock("@/db/client", () => ({
  db: { execute },
}));

describe("provider credit", () => {
  afterEach(() => {
    execute.mockReset();
    vi.resetModules();
  });

  it("keeps internal workspaces unlimited", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          credit_limit_usd_micros: null,
          used_usd_micros: "12000000",
        },
      ],
    });
    const { getWorkspaceProviderCreditStatus } = await import(
      "@/lib/provider-credit"
    );

    await expect(
      getWorkspaceProviderCreditStatus(
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toEqual({
      isExhausted: false,
      limitUsdMicros: null,
      remainingUsdMicros: null,
      usedUsdMicros: 12_000_000,
    });
  });

  it("calculates remaining public workspace credit", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          credit_limit_usd_micros: "5000000",
          used_usd_micros: "1250000",
        },
      ],
    });
    const { getWorkspaceProviderCreditStatus } = await import(
      "@/lib/provider-credit"
    );

    await expect(
      getWorkspaceProviderCreditStatus(
        "11111111-1111-4111-8111-111111111111",
      ),
    ).resolves.toEqual({
      isExhausted: false,
      limitUsdMicros: 5_000_000,
      remainingUsdMicros: 3_750_000,
      usedUsdMicros: 1_250_000,
    });
  });

  it("rejects new provider work once the allowance is used", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          credit_limit_usd_micros: 5_000_000,
          used_usd_micros: 5_000_000,
        },
      ],
    });
    const {
      assertWorkspaceHasProviderCredit,
      providerCreditErrorResponse,
    } = await import("@/lib/provider-credit");

    const error = await assertWorkspaceHasProviderCredit(
      "11111111-1111-4111-8111-111111111111",
    ).catch((caught) => caught);
    const response = providerCreditErrorResponse(error);

    expect(response?.status).toBe(402);
    await expect(response?.json()).resolves.toMatchObject({
      code: "credit_exhausted",
      creditLimitUsdMicros: 5_000_000,
    });
  });

  it("checks the database when a caller omits the cached credit limit", async () => {
    execute.mockResolvedValue({
      rows: [
        {
          credit_limit_usd_micros: 5_000_000,
          used_usd_micros: 5_000_000,
        },
      ],
    });
    const { assertWorkspaceHasProviderCredit } = await import(
      "@/lib/provider-credit"
    );

    await expect(
      assertWorkspaceHasProviderCredit({
        teamId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({ code: "credit_exhausted" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

});
