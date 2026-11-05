import { expect, it } from "vitest";
import { estimateSearchCost } from "@/lib/intel/cost";

it("estimates zero for searches that make no model calls", () => {
  expect(estimateSearchCost([])).toEqual({ lowUsd: 0, highUsd: 0 });
});

it("accounts for repeated evidence, verification, and possible final ranking", () => {
  const batch = { text: "evidence".repeat(1000) };
  const single = estimateSearchCost([batch]);
  const double = estimateSearchCost([batch, batch]);
  expect(single.lowUsd).toBeGreaterThan(0);
  expect(single.highUsd).toBeGreaterThan(single.lowUsd);
  expect(double.lowUsd).toBe(single.lowUsd * 2);
  expect(double.highUsd).toBeGreaterThan(single.highUsd * 2);
});
