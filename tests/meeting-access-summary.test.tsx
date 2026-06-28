import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MeetingAccessSummary } from "@/components/meeting-access-summary";

describe("MeetingAccessSummary", () => {
  it("keeps organization access compact", () => {
    const html = renderToStaticMarkup(
      <MeetingAccessSummary accessPeople={[]} accessScope="workspace" />,
    );

    expect(html).toContain("Organization");
    expect(html).not.toContain("People with access");
  });

  it("lists people for narrow shared access", () => {
    const html = renderToStaticMarkup(
      <MeetingAccessSummary
        accessPeople={[
          { email: "alice@example.com", name: "Alice Chen" },
          { email: "bob@example.com", name: null },
        ]}
        accessScope="shared"
      />,
    );

    expect(html).toContain("Shared with 2 people");
    expect(html).toContain("Alice Chen (alice@example.com)");
    expect(html).toContain("bob@example.com");
  });
});
