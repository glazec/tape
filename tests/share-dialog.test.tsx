import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShareDialog } from "@/components/share-dialog";

describe("ShareDialog", () => {
  it("renders colleague oriented sharing controls without exposing the raw meeting id", () => {
    const html = renderToStaticMarkup(
      <ShareDialog
        customAudience={{
          memberCount: 2,
          name: "Investment committee",
        }}
        initialAccessPeople={[
          { email: "participant@example.com", name: "Meeting Participant" },
        ]}
        initialShares={[
          {
            email: "guest@example.com",
            id: "22222222-2222-4222-8222-222222222222",
            pending: true,
            scope: "single",
          },
        ]}
        instanceId="test"
        meetingId="11111111-1111-4111-8111-111111111111"
        teamMembers={[{ email: "teammate@example.com", name: "Team Mate" }]}
      />,
    );

    expect(html).toContain(">Share<");
    expect(html).not.toContain("Copy link");
    expect(html).toContain(
      "Eligible internal participants receive access automatically. Remove access above or share manually with external guests.",
    );
    expect(html).not.toContain("Participants already have access.");
    expect(html).toContain("Colleague or group");
    expect(html).toContain('data-slot="combobox-input"');
    expect(html).toContain('data-slot="combobox-trigger"');
    expect(html).not.toContain("<datalist");
    expect(html).toContain(
      "Email, whole organization, or Investment committee",
    );
    expect(html).toContain("Include past and future related meetings");
    expect(html).toContain("Share meeting");
    expect(html).not.toContain("Share this meeting with");
    expect(html).not.toContain("Share with organization");
    expect(html).not.toContain("Share with Investment committee");
    expect(html).toContain("People with access");
    expect(html).toContain("Meeting Participant");
    expect(html).toContain("participant@example.com");
    expect(html).toContain("guest@example.com");
    expect(html).toContain("Invite pending");
    expect(html).toContain('aria-label="Remove participant@example.com"');
    expect(html).toContain('aria-label="Remove guest@example.com"');
    expect(html).not.toContain("Manage manual access");
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
