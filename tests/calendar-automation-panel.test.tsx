import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CalendarAutomationPanel } from "@/components/calendar-automation-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

describe("CalendarAutomationPanel", () => {
  it("groups calendar status and sync action when connected", () => {
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
    expect(html).toContain("Disconnect calendar");
  });

  it("defers last checked formatting to the browser timezone", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "UTC";

    try {
      const html = renderToStaticMarkup(
        <CalendarAutomationPanel
          accountLabel="member@iosg.vc"
          autoSync={false}
          status={{
            connected: true,
            autoJoinEnabled: true,
            recallCalendarStatus: "connected",
            recallCalendarLastSyncedAt: "2026-06-30T01:54:11.846Z",
          }}
        />,
      );

      expect(html).toContain(
        '<time dateTime="2026-06-30T01:54:11.846Z">',
      );
      expect(html).not.toContain("Jun 30, 1:54 AM");
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });

  it("shows a connect action when the calendar is not connected", () => {
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
    expect(html).toContain("Future meetings are watched");
    expect(html).not.toContain("Recall");
    expect(html).not.toContain("Disconnect calendar");
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
    expect(html).toContain("Connect calendar to enable recording");
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
    expect(html).not.toContain("Connect calendar to enable recording");
  });
});
