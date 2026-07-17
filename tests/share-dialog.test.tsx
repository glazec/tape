import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShareDialog } from "@/components/share-dialog";

describe("ShareDialog", () => {
  it("renders colleague oriented sharing controls without exposing the raw meeting id", () => {
    const html = renderToStaticMarkup(
      <ShareDialog
        instanceId="test"
        meetingId="11111111-1111-4111-8111-111111111111"
        teamMembers={[{ email: "teammate@example.com", name: "Team Mate" }]}
      />,
    );

    expect(html).toContain(">Share<");
    expect(html).not.toContain("Copy link");
    expect(html).toContain("Participants already have access.");
    expect(html).toContain("Colleague");
    expect(html).toContain("Team Mate");
    expect(html).toContain("Include past and future related meetings");
    expect(html).toContain("Share meeting");
    expect(html).not.toContain("Meeting labels");
    expect(html).not.toContain("Manage labels");
    expect(html).not.toContain("Meeting link");
    expect(html).not.toContain("Select someone in organization");
    expect(html).not.toContain("Add by email");
    expect(html).not.toContain("Sharing grants transcript viewing only");
    expect(html).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(html).not.toContain("Meeting ID");
  });
});
