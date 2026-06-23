export function buildTranscriptSearchQuery(input: string) {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}
