import { describe, expect, it } from "vitest";

import {
  formatCalendarSyncMessage,
  getCalendarConnectHref,
  getCalendarSyncPostSuccessAction,
} from "@/components/calendar-sync-button";

describe("formatCalendarSyncMessage", () => {
  it("shows the captured event count when sync succeeds cleanly", () => {
    expect(formatCalendarSyncMessage({ syncedEventCount: 2 })).toBe(
      "Captured 2 upcoming calendar events.",
    );
  });

  it("shows partial sync review copy without claiming total failure", () => {
    expect(
      formatCalendarSyncMessage({
        failedEventCount: 1,
        syncedEventCount: 2,
      }),
    ).toBe("Captured 2 upcoming calendar events. 1 event needs review.");
  });

  it("shows checked copy when only recoverable event updates failed", () => {
    expect(
      formatCalendarSyncMessage({
        failedEventCount: 3,
        syncedEventCount: 0,
      }),
    ).toBe("Calendar checked. 3 events need review.");
  });

  it("refreshes the dashboard after a manual sync succeeds", () => {
    expect(getCalendarSyncPostSuccessAction(false)).toEqual({
      type: "refresh",
    });
  });

  it("clears the auto sync URL after an OAuth sync succeeds", () => {
    expect(getCalendarSyncPostSuccessAction(true, false)).toEqual({
      href: "/dashboard",
      type: "replace",
    });
  });

  it("keeps the setup guide open after calendar sync succeeds", () => {
    expect(getCalendarSyncPostSuccessAction(false, true)).toEqual({
      href: "/dashboard?setup=1",
      type: "replace",
    });
    expect(getCalendarSyncPostSuccessAction(true, true)).toEqual({
      href: "/dashboard?setup=1",
      type: "replace",
    });
  });

  it("keeps the setup context through calendar OAuth", () => {
    expect(getCalendarConnectHref(false)).toBe("/api/calendar/oauth/start");
    expect(getCalendarConnectHref(true)).toBe(
      "/api/calendar/oauth/start?setup=1",
    );
  });
});
