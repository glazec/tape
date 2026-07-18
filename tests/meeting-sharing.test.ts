import { describe, expect, it } from "vitest";

import {
  getMeetingShareMatchKeys,
  hasReliableMeetingShareMatchKeys,
  meetingsShareReliableMatch,
} from "@/lib/meeting-sharing";

describe("meeting sharing", () => {
  it("matches related meetings by exact participant or title and company", () => {
    const currentKeys = getMeetingShareMatchKeys({
      attendeeEmails: ["alice@nascent.xyz", "owner@iosg.vc"],
      title: "IOSG <> Nascent",
      workspaceDomain: "iosg.vc",
    });

    expect(currentKeys).toEqual([
      "title:iosg <> nascent",
      "participant:email:alice@nascent.xyz",
      "participant:domain:nascent.xyz",
    ]);
    expect(
      meetingsShareReliableMatch(
        currentKeys,
        getMeetingShareMatchKeys({
          attendeeEmails: ["alice@nascent.xyz"],
          title: "Quarterly update",
          workspaceDomain: "iosg.vc",
        }),
      ),
    ).toBe(true);
    expect(
      meetingsShareReliableMatch(
        currentKeys,
        getMeetingShareMatchKeys({
          attendeeEmails: ["bob@example.com"],
          title: "Unrelated call",
          workspaceDomain: "iosg.vc",
        }),
      ),
    ).toBe(false);

    expect(
      meetingsShareReliableMatch(
        getMeetingShareMatchKeys({
          attendeeEmails: ["alice@nascent.xyz"],
          title: "Quarterly update",
          workspaceDomain: "iosg.vc",
        }),
        getMeetingShareMatchKeys({
          attendeeEmails: ["bob@nascent.xyz"],
          title: "Quarterly update",
          workspaceDomain: "iosg.vc",
        }),
      ),
    ).toBe(true);
    expect(
      meetingsShareReliableMatch(
        getMeetingShareMatchKeys({
          attendeeEmails: ["alice@nascent.xyz"],
          title: "Quarterly update",
          workspaceDomain: "iosg.vc",
        }),
        getMeetingShareMatchKeys({
          attendeeEmails: ["bob@other.xyz"],
          title: "Quarterly update",
          workspaceDomain: "iosg.vc",
        }),
      ),
    ).toBe(false);
    expect(
      meetingsShareReliableMatch(
        getMeetingShareMatchKeys({
          attendeeEmails: ["alice@nascent.xyz"],
          title: "Quarterly update",
          workspaceDomain: "iosg.vc",
        }),
        getMeetingShareMatchKeys({
          attendeeEmails: ["bob@nascent.xyz"],
          title: "Product demo",
          workspaceDomain: "iosg.vc",
        }),
      ),
    ).toBe(false);
  });

  it("requires an exact participant or a title and company pair", () => {
    expect(
      hasReliableMeetingShareMatchKeys(["participant:email:a@vendor.com"]),
    ).toBe(true);
    expect(
      hasReliableMeetingShareMatchKeys([
        "title:weekly sync",
        "participant:domain:vendor.com",
      ]),
    ).toBe(true);
    expect(hasReliableMeetingShareMatchKeys(["title:weekly sync"])).toBe(
      false,
    );
    expect(
      hasReliableMeetingShareMatchKeys(["participant:domain:vendor.com"]),
    ).toBe(false);
  });

  it("does not create broad title rules for generic meeting names", () => {
    expect(
      getMeetingShareMatchKeys({
        attendeeEmails: [],
        title: "Google Meet",
        workspaceDomain: "iosg.vc",
      }),
    ).toEqual([]);
  });
});
