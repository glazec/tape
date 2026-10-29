// Each bar retains the strongest short audio window in its time interval.
export function resampleAudioPeaks(peaks: readonly number[], count: number) {
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((index * peaks.length) / count);
    const end = Math.min(
      peaks.length,
      Math.max(start + 1, Math.floor(((index + 1) * peaks.length) / count)),
    );
    let peak = 0;
    for (let sample = start; sample < end; sample += 1) {
      peak = Math.max(peak, peaks[sample]);
    }
    return peak;
  });
}

export function normalizeAudioPeaks(peaks: readonly number[]) {
  const sorted = peaks.filter((peak) => peak > 0).sort((a, b) => a - b);
  // A single click should not flatten the rest of the conversation.
  const reference = Math.max(
    sorted[Math.ceil(sorted.length * 0.98) - 1] ?? 0,
    0.01,
  );
  return peaks.map((peak) => Math.min(1, Math.max(0, peak / reference)) ** 2);
}
