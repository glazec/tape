import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  db: {},
}));

import {
  dollarsToUsdMicros,
  getElevenLabsRateUsdMicrosPerHour,
  prorateHourlyCostUsdMicros,
} from "@/lib/provider-usage";
import {
  formatUsdMicros,
  getCreditUsagePercent,
  getProviderUsagePeriodLabel,
  normalizeProviderUsagePeriod,
} from "@/lib/provider-usage-queries";

describe("provider usage pricing", () => {
  it("prorates published hourly rates to the millisecond", () => {
    expect(prorateHourlyCostUsdMicros(30 * 60 * 1000, 500_000)).toBe(250_000);
    expect(prorateHourlyCostUsdMicros(1_000, 500_000)).toBe(139);
  });

  it("includes the ElevenLabs features Tape enables", () => {
    expect(getElevenLabsRateUsdMicrosPerHour(false)).toBe(290_000);
    expect(getElevenLabsRateUsdMicrosPerHour(true)).toBe(340_000);
  });

  it("stores provider reported dollars as integer microdollars", () => {
    expect(dollarsToUsdMicros(0.001234)).toBe(1_234);
    expect(dollarsToUsdMicros(Number.NaN)).toBe(0);
  });

  it("keeps small costs visible instead of rounding them to zero", () => {
    expect(formatUsdMicros(1_234)).toBe("$0.0012");
    expect(formatUsdMicros(250_000)).toBe("$0.25");
  });

  it("normalizes billing periods and labels rolling periods", () => {
    expect(normalizeProviderUsagePeriod("last_90_days")).toBe("last_90_days");
    expect(normalizeProviderUsagePeriod("unknown")).toBe("current_month");
    expect(
      getProviderUsagePeriodLabel(
        "previous_month",
        new Date("2026-07-24T12:00:00.000Z"),
      ),
    ).toBe("June 2026");
  });

  it("caps the displayed credit consumption percentage", () => {
    expect(
      getCreditUsagePercent({
        limitUsdMicros: 5_000_000,
        usedUsdMicros: 6_000_000,
      }),
    ).toBe(100);
    expect(
      getCreditUsagePercent({
        limitUsdMicros: null,
        usedUsdMicros: 6_000_000,
      }),
    ).toBe(0);
  });
});
