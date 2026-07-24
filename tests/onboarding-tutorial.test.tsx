import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OnboardingTutorial } from "@/components/onboarding-tutorial";

vi.mock("@/components/onboarding-dismiss-button", () => ({
  OnboardingDismissButton: () => <button type="button">Hide tutorial</button>,
}));

vi.mock("@/components/calendar-sync-button", () => ({
  CalendarSyncButton: ({ connected }: { connected: boolean }) => (
    <button type="button">
      {connected ? "Sync calendar" : "Connect calendar"}
    </button>
  ),
}));

describe("OnboardingTutorial", () => {
  it("shows the three setup steps and their real destinations", () => {
    const html = renderToStaticMarkup(
      <OnboardingTutorial
        calendarStatus={{
          connected: false,
          autoJoinEnabled: false,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: null,
        }}
        dismissalCookieName="tape_onboarding_hidden_user_team"
      />,
    );

    expect(html).toContain("Set up Tape");
    expect(html).toContain("Connect your calendar");
    expect(html).toContain("Get the desktop app");
    expect(html).toContain("Connect the MCP server");
    expect(html).toContain("Connect calendar");
    expect(html).toContain(
      "https://github.com/glazec/tape/releases/tag/mac-v0.2.0",
    );
    expect(html).toContain(
      "https://github.com/glazec/tape/blob/main/docs/meeting-note-mcp-api.md",
    );
    expect(html).toContain("Show MCP setup");
    expect(html).toContain("Streamable HTTP");
    expect(html).toContain("Show macOS setup");
    expect(html).toContain("xattr -dr com.apple.quarantine");
  });

  it("marks the calendar step complete only when capture is operational", () => {
    const html = renderToStaticMarkup(
      <OnboardingTutorial
        calendarStatus={{
          connected: true,
          autoJoinEnabled: true,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: "connected",
        }}
        dismissalCookieName="tape_onboarding_hidden_user_team"
      />,
    );

    expect(html).toContain("Calendar connected");
    expect(html).not.toContain("Connect calendar");
  });

  it("offers recovery while the calendar connection is still syncing", () => {
    const html = renderToStaticMarkup(
      <OnboardingTutorial
        calendarStatus={{
          connected: true,
          autoJoinEnabled: true,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: "connecting",
        }}
        dismissalCookieName="tape_onboarding_hidden_user_team"
      />,
    );

    expect(html).toContain("Finish calendar sync");
    expect(html).toContain("Sync calendar");
    expect(html).not.toContain("Calendar connected");
  });
});
