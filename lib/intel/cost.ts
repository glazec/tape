// November 4, 2026 calibration: 10th and 90th percentile USD per million
// billed tokens across 736 production OpenRouter assistant calls over 24h.
// Jev selects the serving model dynamically, so this range is not a price cap.
export function estimateSearchCost(batches: readonly unknown[]) {
  let lowTokens = 0;
  let highTokens = 0;
  for (const batch of batches) {
    const bytes = Buffer.byteLength(JSON.stringify(batch));
    // Smaller scenario: matching only. Larger: also verify candidates and
    // their evidence. Include prompt overhead and the configured output caps.
    lowTokens += Math.ceil(bytes / 4) + 1000;
    highTokens += 2 * Math.ceil(bytes / 2) + 16000 + 2500 + 4000;
  }
  if (batches.length > 1) highTokens += 1000 + 4000 * batches.length;
  return {
    lowUsd: lowTokens * 0.11135 / 1_000_000,
    highUsd: highTokens * 1.05843 / 1_000_000,
  };
}
