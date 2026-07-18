import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MeetingAccessSummary } from "@/components/meeting-access-summary";

describe("MeetingAccessSummary", () => {
  it("shows when a managed meeting is private", () => {
    const html = renderToStaticMarkup(
      <MeetingAccessSummary accessPeople={[]} accessScope="workspace" />,
    );

    expect(html).toContain("Not shared beyond participants");
    expect(html).not.toContain("People with access");
  });

  it("keeps shared access details compact", () => {
    const html = renderToStaticMarkup(
      <MeetingAccessSummary
        accessPeople={[
          { email: "alice@example.com", name: "Alice Chen" },
          { email: "bob@example.com", name: null },
        ]}
        accessScope="shared"
      />,
    );

    expect(html).toContain("Shared with you");
    expect(html).not.toContain("alice@example.com");
    expect(html).not.toContain("bob@example.com");
  });

  it("shows organization access instead of calling the meeting private", () => {
    const html = renderToStaticMarkup(
      <MeetingAccessSummary
        accessPeople={[]}
        accessScope="workspace"
        organizationShared
      />,
    );

    expect(html).toContain("Shared with organization");
    expect(html).not.toContain("Not shared beyond participants");
  });
});
