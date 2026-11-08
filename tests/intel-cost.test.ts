import { expect, it } from "vitest";
import { DEFAULT_INTEL_PRICING, estimateSearchCost, pricingFromUsage } from "@/lib/intel/cost";

it("estimates zero for searches that make no model calls", () => {
  expect(estimateSearchCost([])).toEqual({ lowUsd: 0, highUsd: 0, expectedUsd: 0, seconds: 0, batches: 0 });
});

it("accounts for every scoring batch without verifier or model ranking charges", () => {
  const batch = { text: "evidence".repeat(1000) };
  const single = estimateSearchCost([batch]);
  const double = estimateSearchCost([batch, batch]);
  expect(single.lowUsd).toBeGreaterThan(0);
  expect(single.expectedUsd).toBeGreaterThan(single.lowUsd);
  expect(single.highUsd).toBeGreaterThan(single.expectedUsd);
  expect(double.lowUsd).toBe(single.lowUsd * 2);
  expect(double.highUsd).toBe(single.highUsd * 2);
});

it("estimates direct Jev input pricing instead of historical router charges", () => {
  const batches = Array.from({ length: 6 }, () => ({ text: "x".repeat(336_000) }));
  const estimate = estimateSearchCost(batches);
  expect(DEFAULT_INTEL_PRICING.typicalUsdPerMTok).toBe(0.042);
  expect(estimate.expectedUsd).toBeGreaterThan(0.028);
  expect(estimate.expectedUsd).toBeLessThan(0.04);
  expect(estimate.highUsd).toBeGreaterThan(estimate.expectedUsd);
});

it("learns per-token prices from tagged usage once enough calls exist", () => {
  expect(pricingFromUsage([{ costUsdMicros: 1, quantity: 1 }])).toEqual(DEFAULT_INTEL_PRICING);
  const samples = [0.03, 0.1, 0.34, 0.34, 0.35, 0.35, 0.9, 1.2].map(rate => ({ costUsdMicros: rate * 100_000, quantity: 100_000 }));
  const pricing = pricingFromUsage(samples);
  expect(pricing.typicalUsdPerMTok).toBeCloseTo(0.35);
  expect(pricing.lowUsdPerMTok).toBeLessThanOrEqual(pricing.typicalUsdPerMTok);
  expect(pricing.highUsdPerMTok).toBeGreaterThanOrEqual(pricing.typicalUsdPerMTok * 2);
  expect(pricing.samples).toBe(8);
});
it("estimates time from the parallel batch limit", () => {
  expect(estimateSearchCost(Array.from({ length: 81 }, () => ({}))).seconds).toBe(30 + Math.ceil(81 / 16) * 4);
});
