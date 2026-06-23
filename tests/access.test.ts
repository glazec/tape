import { describe, expect, it } from "vitest";
import { canAutoGrantAttendeeAccess, normalizeEmailDomain } from "@/lib/access";

describe("normalizeEmailDomain", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeEmailDomain(" Alice@Example.COM ")).toBe("example.com");
  });
});

describe("canAutoGrantAttendeeAccess", () => {
  it("grants access to existing members on allowed domains", () => {
    expect(
      canAutoGrantAttendeeAccess({
        attendeeEmail: "alice@example.com",
        memberEmails: ["alice@example.com"],
        allowedDomains: ["example.com"],
      }),
    ).toBe(true);
  });

  it("denies external attendees even when present on the calendar", () => {
    expect(
      canAutoGrantAttendeeAccess({
        attendeeEmail: "guest@vendor.com",
        memberEmails: ["alice@example.com"],
        allowedDomains: ["example.com"],
      }),
    ).toBe(false);
  });

  it("denies internal domain emails that are not workspace members", () => {
    expect(
      canAutoGrantAttendeeAccess({
        attendeeEmail: "newhire@example.com",
        memberEmails: ["alice@example.com"],
        allowedDomains: ["example.com"],
      }),
    ).toBe(false);
  });
});
