import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingPricing } from "@/components/landing/landing-pricing";
import { buildCalendarEstimatePayload } from "@/lib/pricing-calendar-estimate";

describe("LandingPricing", () => {
  it("makes every manual usage assumption directly editable", () => {
    const html = renderToStaticMarkup(<LandingPricing />);

    expect(html).toContain("Assumptions you can edit");
    expect(html).toContain("Team members using Tape");
    expect(html).toContain("Meeting hours per teammate");
    expect(html).toContain("Tape users sharing each meeting");
    expect(html).toContain("Scheduled meeting time recorded");
    expect(html).toContain("Estimated monthly total");
    expect(html.match(/data-slot="input"/g)).toHaveLength(4);
    expect(html).not.toContain('type="range"');
    expect(html.indexOf("Estimated monthly total")).toBeLessThan(
      html.indexOf("Attendee (self-host)"),
    );
  });

  it("labels one connected calendar as a sample and keeps assumptions editable", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [
        {
          status: "confirmed",
          eventType: "default",
          start: { dateTime: "2026-07-01T10:00:00Z" },
          end: { dateTime: "2026-07-01T11:00:00Z" },
          organizer: { email: "me@acme.com", self: true },
          attendees: [
            {
              email: "me@acme.com",
              self: true,
              responseStatus: "accepted",
            },
            {
              email: "colleague@acme.com",
              responseStatus: "accepted",
            },
          ],
        },
      ],
      lookbackDays: 30,
    });
    const html = renderToStaticMarkup(
      <LandingPricing
        calendarStatus="connected"
        calendarEstimate={{ status: "ready", payload }}
      />,
    );

    expect(html).toContain("What this calendar measured");
    expect(html).toContain("Only your primary calendar was measured");
    expect(html).toContain(
      "Google did not expose colleagues&#x27; other meetings",
    );
    expect(html).toContain("Edit it if you are not representative");
    expect(html).toContain("Some may not use Tape");
    expect(html).toContain(
      "Google cannot tell which colleagues will use Tape",
    );
    expect(html).toContain('value="1"');
    expect(html.match(/data-slot="input"/g)).toHaveLength(4);
  });

  it("discloses the retained date span when the calendar reaches 2,000 events", () => {
    const payload = buildCalendarEstimatePayload({
      organizerEmail: "me@acme.com",
      rawEvents: [],
      lookbackDays: 41.65,
      eventLimitReached: true,
    });
    const html = renderToStaticMarkup(
      <LandingPricing
        calendarStatus="connected"
        calendarEstimate={{ status: "ready", payload }}
      />,
    );

    expect(html).toContain("Calendar limit reached");
    expect(html).toContain("the first 2,000 events");
    expect(html).toContain("their 41.7 day span");
    expect(html.match(/data-slot="input"/g)).toHaveLength(4);
  });
});
