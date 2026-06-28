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
        accountLabel="member@iosg.vc"
        autoSync={false}
        nextJoinTitle="IOSG Weekly Team Meeting"
        status={{
          connected: true,
          autoJoinEnabled: true,
          recallCalendarStatus: "connected",
          recallCalendarLastSyncedAt: "2026-06-27T12:00:00.000Z",
        }}
      />,
    );

    expect(html).toContain("Calendar capture");
    expect(html).toContain("Calendar connected");
    expect(html).toContain("member@iosg.vc");
    expect(html).toContain("Recording coverage on");
    expect(html).toContain("Next join: IOSG Weekly Team Meeting");
    expect(html).toContain("Last checked");
    expect(html).toContain("Sync calendar");
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
    expect(html).toContain("Check Recall calendar");
    expect(html).toContain("Future meetings are watched");
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

    expect(html).toContain("Recording coverage off");
    expect(html).toContain("Connect calendar in Recall first");
    expect(html).not.toContain("Eligible online meetings are recorded");
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

    expect(html).toContain("Recording coverage off");
    expect(html).toContain("Sync calendar to enable recording");
    expect(html).not.toContain("Connect calendar in Recall first");
  });
});
