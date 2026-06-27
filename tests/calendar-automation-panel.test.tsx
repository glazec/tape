import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CalendarAutomationPanel } from "@/components/calendar-automation-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

describe("CalendarAutomationPanel", () => {
  it("groups Recall calendar status and sync action when connected", () => {
    const html = renderToStaticMarkup(
      <CalendarAutomationPanel
        autoSync={false}
        status={{
          connected: true,
          autoJoinEnabled: true,
          recallCalendarStatus: "connected",
          recallCalendarLastSyncedAt: "2026-06-27T12:00:00.000Z",
        }}
      />,
    );

    expect(html).toContain("Calendar automation");
    expect(html).toContain("Recall Calendar connected");
    expect(html).toContain("Team bot coverage on");
    expect(html).toContain("Last checked");
    expect(html).toContain("Sync Recall calendar");
  });

  it("shows a connect action when Recall Calendar is not connected", () => {
    const html = renderToStaticMarkup(
      <CalendarAutomationPanel
        autoSync={false}
        status={{
          connected: false,
          autoJoinEnabled: false,
          recallCalendarStatus: null,
          recallCalendarLastSyncedAt: null,
        }}
      />,
    );

    expect(html).toContain("Calendar not connected");
    expect(html).toContain("Connect calendar");
    expect(html).toContain("Recall watches future calendar changes");
  });

  it("does not claim auto join is active without a Recall Calendar connection", () => {
    const html = renderToStaticMarkup(
      <CalendarAutomationPanel
        autoSync={false}
        status={{
          connected: false,
          autoJoinEnabled: true,
          recallCalendarStatus: null,
          recallCalendarLastSyncedAt: null,
        }}
      />,
    );

    expect(html).toContain("Team bot coverage off");
    expect(html).toContain("Connect calendar to enable bots");
    expect(html).not.toContain("One bot joins each eligible meeting");
  });

  it("uses sync copy when the calendar is connected but auto join is off", () => {
    const html = renderToStaticMarkup(
      <CalendarAutomationPanel
        autoSync={false}
        status={{
          connected: true,
          autoJoinEnabled: false,
          recallCalendarStatus: "connected",
          recallCalendarLastSyncedAt: null,
        }}
      />,
    );

    expect(html).toContain("Team bot coverage off");
    expect(html).toContain("Sync calendar to enable bots");
    expect(html).not.toContain("Connect calendar to enable bots");
  });
});
