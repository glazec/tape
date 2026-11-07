// Cost estimates use direct Jev decision pricing. Searches score candidates once;
// sorting and source access checks do not make additional model calls.
export type IntelPricing = { lowUsdPerMTok: number; typicalUsdPerMTok: number; highUsdPerMTok: number; samples: number };
export const DEFAULT_INTEL_PRICING: IntelPricing = { lowUsdPerMTok: 0.021, typicalUsdPerMTok: 0.042, highUsdPerMTok: 0.084, samples: 0 };
const BYTES_PER_TOKEN = 3;
// Includes typed questions and evidence option identifiers for up to 12 people.
// Jev output tokens are free; the range allows for input token estimation error.
const PROMPT_OVERHEAD_TOKENS = 9000;
export const PARALLEL_BATCHES = 3;
// Conservative estimate based on previous router waves; scoring timings may vary.
const SECONDS_PER_WAVE = 150;
const FIXED_SECONDS = 20;

export type SearchEstimate = { lowUsd: number; highUsd: number; expectedUsd: number; seconds: number; batches: number };

export function estimateSearchCost(batches: readonly unknown[], pricing: IntelPricing = DEFAULT_INTEL_PRICING): SearchEstimate {
  if (!batches.length) return { lowUsd: 0, highUsd: 0, expectedUsd: 0, seconds: 0, batches: 0 };
  let prompt = 0;
  for (const batch of batches) prompt += Math.ceil(Buffer.byteLength(JSON.stringify(batch)) / BYTES_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
  const n = batches.length;
  return {
    lowUsd: (prompt * pricing.lowUsdPerMTok) / 1_000_000,
    expectedUsd: (prompt * pricing.typicalUsdPerMTok) / 1_000_000,
    highUsd: (prompt * pricing.highUsdPerMTok) / 1_000_000,
    seconds: FIXED_SECONDS + Math.ceil(n / PARALLEL_BATCHES) * SECONDS_PER_WAVE,
    batches: n,
  };
}

// USD micros per token equals USD per million tokens.
export function pricingFromUsage(samples: { costUsdMicros: number; quantity: number }[]): IntelPricing {
  const rates = samples.filter(s => s.quantity > 0).map(s => s.costUsdMicros / s.quantity).sort((a, b) => a - b);
  if (rates.length < 6) return DEFAULT_INTEL_PRICING;
  const at = (q: number) => rates[Math.min(rates.length - 1, Math.floor(q * rates.length))];
  const typical = at(0.5);
  return { lowUsdPerMTok: Math.min(at(0.1), typical), typicalUsdPerMTok: typical, highUsdPerMTok: Math.max(at(0.9), typical * 2), samples: rates.length };
}
