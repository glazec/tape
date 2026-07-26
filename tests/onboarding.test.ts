import { describe, expect, it } from "vitest";

import { isOnboardingAutomaticallyComplete } from "@/lib/onboarding";

const connectedCalendar = {
  autoJoinEnabled: true,
  connected: true,
  recallCalendarStatus: "connected",
};

describe("onboarding completion", () => {
  it("completes automatically after calendar, desktop app, and MCP use", () => {
    expect(
      isOnboardingAutomaticallyComplete({
        calendarStatus: connectedCalendar,
        desktopAppConnected: true,
        mcpUsed: true,
      }),
    ).toBe(true);
  });

  it("requires every setup signal", () => {
    expect(
      isOnboardingAutomaticallyComplete({
        calendarStatus: connectedCalendar,
        desktopAppConnected: false,
        mcpUsed: true,
      }),
    ).toBe(false);
    expect(
      isOnboardingAutomaticallyComplete({
        calendarStatus: connectedCalendar,
        desktopAppConnected: true,
        mcpUsed: false,
      }),
    ).toBe(false);
    expect(
      isOnboardingAutomaticallyComplete({
        calendarStatus: {
          ...connectedCalendar,
          recallCalendarStatus: "connecting",
        },
        desktopAppConnected: true,
        mcpUsed: true,
      }),
    ).toBe(false);
  });
});
