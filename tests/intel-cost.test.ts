import { expect, it } from "vitest";
import { DEFAULT_INTEL_PRICING, estimateSearchCost, pricingFromUsage } from "@/lib/intel/cost";

it("estimates zero for searches that make no model calls", () => {
  expect(estimateSearchCost([])).toEqual({ lowUsd: 0, highUsd: 0, expectedUsd: 0, seconds: 0, batches: 0 });
});

it("accounts for repeated evidence, verification, and possible final ranking", () => {
  const batch = { text: "evidence".repeat(1000) };
  const single = estimateSearchCost([batch]);
  const double = estimateSearchCost([batch, batch]);
  expect(single.lowUsd).toBeGreaterThan(0);
  expect(single.expectedUsd).toBeGreaterThan(single.lowUsd);
  expect(single.highUsd).toBeGreaterThan(single.expectedUsd);
  expect(double.lowUsd).toBe(single.lowUsd * 2);
  expect(double.highUsd).toBeGreaterThan(single.highUsd * 2);
});

it("brackets the measured Nov 5 production search", () => {
  // Six ~336 KB batches; the real run cost $0.217 and the matching wave took up to 3.5 minutes.
  const batches = Array.from({ length: 6 }, () => ({ text: "x".repeat(336_000) }));
  const estimate = estimateSearchCost(batches);
  expect(estimate.lowUsd).toBeLessThan(0.217);
  expect(estimate.highUsd).toBeGreaterThan(0.217);
  expect(estimate.expectedUsd).toBeGreaterThan(0.2);
  expect(estimate.expectedUsd).toBeLessThan(0.35);
  expect(estimate.highUsd / estimate.lowUsd).toBeLessThan(6);
  expect(estimate.seconds).toBe(320);
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
