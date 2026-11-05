// Intel cost and time estimates.
//
// Calibrated on the Nov 5, 2026 production search (6 batches, ~2 MB of batch
// JSON): matching prompts measured ~3 bytes per token plus ~1.2k tokens of
// instructions and schema, outputs 4.9k to 10.3k tokens, and the Jev verifier
// read ~1.4x the matching prompt at $0.042 per million tokens. The router
// served matching with DeepSeek Flash at ~$0.34 per million tokens (lower with
// prompt cache hits). Actual cost was $0.217 against an expected $0.24.
//
// `jev-router` can escalate to a larger model, so the high bound prices
// matching at a Gemini Flash class rate. When enough recent intel calls are
// tagged in provider usage, the per-token prices come from that history instead.
export type IntelPricing = { lowUsdPerMTok: number; typicalUsdPerMTok: number; highUsdPerMTok: number; samples: number };
export const DEFAULT_INTEL_PRICING: IntelPricing = { lowUsdPerMTok: 0.2, typicalUsdPerMTok: 0.34, highUsdPerMTok: 1, samples: 0 };
const VERIFIER_USD_PER_MTOK = 0.042;
const BYTES_PER_TOKEN = 3;
const PROMPT_OVERHEAD_TOKENS = 1200;
const OUTPUT_TOKENS = { low: 5000, typical: 6500, high: 12000 };
const RANKING_TOKENS = 25000;
export const PARALLEL_BATCHES = 3;
// Observed matching waves took 40s to 210s; verification adds a few seconds.
const SECONDS_PER_WAVE = 150;
const FIXED_SECONDS = 20;

export type SearchEstimate = { lowUsd: number; highUsd: number; expectedUsd: number; seconds: number; batches: number };

export function estimateSearchCost(batches: readonly unknown[], pricing: IntelPricing = DEFAULT_INTEL_PRICING): SearchEstimate {
  if (!batches.length) return { lowUsd: 0, highUsd: 0, expectedUsd: 0, seconds: 0, batches: 0 };
  let prompt = 0;
  for (const batch of batches) prompt += Math.ceil(Buffer.byteLength(JSON.stringify(batch)) / BYTES_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS;
  const verifier = prompt * 1.4 * VERIFIER_USD_PER_MTOK;
  const n = batches.length;
  const ranking = n > 1 ? RANKING_TOKENS : 0;
  return {
    lowUsd: ((prompt + OUTPUT_TOKENS.low * n) * pricing.lowUsdPerMTok + verifier) / 1_000_000,
    expectedUsd: ((prompt + OUTPUT_TOKENS.typical * n) * pricing.typicalUsdPerMTok + verifier) / 1_000_000,
    highUsd: ((prompt + OUTPUT_TOKENS.high * n + ranking) * pricing.highUsdPerMTok + verifier) / 1_000_000,
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
