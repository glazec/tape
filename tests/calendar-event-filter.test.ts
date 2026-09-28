import { describe, expect, it } from "vitest";
import { getExcludedCalendarEventKind } from "@/lib/calendar-event-filter";

describe("calendar itinerary and reservation filtering", () => {
  it.each([
    "Flight to Newark (UA 274)",
    "Flight to San Francisco (UA274)",
    " flight from London (BA 123) ",
    "Flight to Hong Kong (CX 830)",
    "Flight to Tokyo (6E 1234)",
  ])("excludes %s", (title) => {
    expect(getExcludedCalendarEventKind(title)).toBe("flight");
  });

  it.each([
    "Reservation at Blue Blossom", " reservation at Blue Blossom ",
    "RESERVATION AT Le Bernardin",
  ])("excludes %s", (title) => {
    expect(getExcludedCalendarEventKind(title)).toBe("reservation");
  });

  it.each([
    "Reservation platform demo", "Discuss reservation at Blue Blossom",
    "Lunch with Blue Blossom team", "Reservation at ",
    "Flight planning meeting", "Flight to Newark planning",
    "Review Flight to Newark (UA 274)", "Flight to Newark (UA 274) debrief",
    "Office visit", "Airport team sync", "Flight product demo",
  ])("keeps %s", (title) => {
    expect(getExcludedCalendarEventKind(title)).toBeNull();
  });
});
