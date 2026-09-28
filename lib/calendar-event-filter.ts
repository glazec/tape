// Match imported itinerary and reservation titles, not general meeting topics.
export function getExcludedCalendarEventKind(title: string): "flight" | "reservation" | null {
  const normalizedTitle = title.normalize("NFKC").trim();
  if (/^flight\s+(?:to|from)\s+.+\s*\([a-z0-9]{2,3}\s*\d{1,4}[a-z]?\)$/i.test(normalizedTitle)) {
    return "flight";
  }
  if (/^reservation\s+at\s+\S.*$/i.test(normalizedTitle)) {
    return "reservation";
  }
  return null;
}
