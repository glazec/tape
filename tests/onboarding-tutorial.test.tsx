// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OnboardingTutorial } from "@/components/onboarding-tutorial";

vi.mock("@/components/onboarding-dismiss-button", () => ({
  OnboardingDismissButton: ({
    onDismiss,
  }: {
    onDismiss?: () => void;
  }) => (
    <button onClick={onDismiss} type="button">
      Hide tutorial
    </button>
  ),
}));

vi.mock("@/components/calendar-sync-button", () => ({
  CalendarSyncButton: ({
    autoSync,
    connected,
    setupMode,
  }: {
    autoSync?: boolean;
    connected: boolean;
    setupMode?: boolean;
  }) => (
    <button
      data-auto-sync={autoSync ? "true" : "false"}
      data-setup-mode={setupMode ? "true" : "false"}
      type="button"
    >
      {connected ? "Sync calendar" : "Connect calendar"}
    </button>
  ),
}));

describe("OnboardingTutorial", () => {
  it("shows the three setup steps and their real destinations", () => {
    const html = renderToStaticMarkup(
      <OnboardingTutorial
        autoSyncCalendar={false}
        calendarStatus={{
          connected: false,
          autoJoinEnabled: false,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: null,
        }}
        dismissalCookieName="tape_onboarding_hidden_user_team"
        forceCalendarSync={false}
      />,
    );

    expect(html).toContain("Set up Tape");
    expect(html).toContain("Connect your calendar");
    expect(html).toContain("Get the desktop app");
    expect(html).toContain("Connect the MCP server");
    expect(html).toContain("Connect calendar");
    expect(html).toContain(
      "https://github.com/glazec/tape/releases/latest/download/Tape-Desktop.zip",
    );
    expect(html).toContain(
      "https://github.com/glazec/tape/blob/main/docs/meeting-note-mcp-api.md",
    );
    expect(html).toContain("MCP setup instructions");
    expect(html).toContain("Streamable HTTP");
    expect(html).toContain(
      "https://meeting-note-mcp-production.up.railway.app/mcp",
    );
    expect(html).toContain("Copy MCP server link");
    expect(html).toContain(
      'href="https://github.com/glazec/tape/releases/latest/download/Tape-Desktop.zip"',
    );
    expect(html).toContain("Download app");
    expect(html).toContain("macOS setup instructions");
    expect(html).toContain("Tape Desktop.app");
    expect(html).toContain(
      "xattr -dr com.apple.quarantine &quot;/Applications/Tape Desktop.app&quot;",
    );
    expect(html).not.toContain("MeetingNoteLocalRecorder.app");
    expect(html.indexOf("Copy MCP server link")).toBeLessThan(
      html.indexOf("MCP server link</p>"),
    );
    expect(html.indexOf("MCP server link</p>")).toBeLessThan(
      html.indexOf("MCP setup instructions"),
    );
  });

  it("marks the calendar step complete only when capture is operational", () => {
    const html = renderToStaticMarkup(
      <OnboardingTutorial
        autoSyncCalendar={false}
        calendarStatus={{
          connected: true,
          autoJoinEnabled: true,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: "connected",
        }}
        dismissalCookieName="tape_onboarding_hidden_user_team"
        forceCalendarSync={false}
      />,
    );

    expect(html).toContain("Calendar connected");
    expect(html).not.toContain("Connect calendar");
  });

  it("offers recovery while the calendar connection is still syncing", () => {
    const html = renderToStaticMarkup(
      <OnboardingTutorial
        autoSyncCalendar
        calendarStatus={{
          connected: true,
          autoJoinEnabled: true,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: "connecting",
        }}
        dismissalCookieName="tape_onboarding_hidden_user_team"
        forceCalendarSync={false}
      />,
    );

    expect(html).toContain("Finish calendar sync");
    expect(html).toContain("Sync calendar");
    expect(html).toContain('data-auto-sync="true"');
    expect(html).toContain('data-setup-mode="true"');
    expect(html).not.toContain("Calendar connected");
  });

  it("forces a retry when the initial event sync failed", () => {
    const html = renderToStaticMarkup(
      <OnboardingTutorial
        autoSyncCalendar
        calendarStatus={{
          connected: true,
          autoJoinEnabled: true,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: "connected",
        }}
        dismissalCookieName="tape_onboarding_hidden_user_team"
        forceCalendarSync
      />,
    );

    expect(html).toContain("Finish calendar sync");
    expect(html).toContain("Sync calendar");
    expect(html).not.toContain("Calendar connected");
  });

  it("shows the dashboard skeleton immediately after dismissal", () => {
    render(
      <OnboardingTutorial
        autoSyncCalendar={false}
        calendarStatus={{
          connected: false,
          autoJoinEnabled: false,
          recallCalendarLastSyncedAt: null,
          recallCalendarStatus: null,
        }}
        dismissedFallback={<div>Loading dashboard overview</div>}
        dismissalCookieName="tape_onboarding_hidden_user_team"
        forceCalendarSync={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide tutorial" }));

    expect(screen.queryByText("Set up Tape")).toBeNull();
    expect(screen.getByText("Loading dashboard overview").textContent).toBe(
      "Loading dashboard overview",
    );
  });
});
