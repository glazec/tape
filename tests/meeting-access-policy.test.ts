import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  getMeetingAccessScope,
  getPersonalReadableMeetingsCondition,
  getReadableMeetingsCondition,
} from "@/lib/meeting-access-policy";

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

describe("meeting access policy", () => {
  it("limits personal reads to owners and active grants", () => {
    const query = toQuery(
      getPersonalReadableMeetingsCondition({
        teamId: "team_123",
        userId: "user_123",
        domain: "example.com",
        canCreateMeetings: true,
      }),
    );

    expect(query.sql).toContain('"meetings"."owner_user_id" = $1');
    expect(query.sql).not.toContain('"team_memberships"');
    expect(query.sql).not.toContain("organization_access_enabled");
    expect(query.sql).toContain('"meeting_access"');
    expect(query.sql).toContain('"meeting_access"."revoked_at" is null');
    expect(query.sql).not.toContain('"meetings"."team_id" =');
    expect(query.params).toEqual(["user_123", "user_123"]);
  });

  it("preserves direct meeting reads for team managers", () => {
    const query = toQuery(
      getReadableMeetingsCondition({
        teamId: "team_123",
        userId: "user_123",
        domain: "example.com",
        canCreateMeetings: true,
      }),
    );

    expect(query.sql).toContain('"meetings"."owner_user_id"');
    expect(query.sql).toContain('"meeting_access"');
    expect(query.sql).toContain('"team_memberships"');
    expect(query.sql).toContain('"team_memberships"."role" in (');
    expect(query.params).toEqual([
      "user_123",
      "user_123",
      "admin",
      "owner",
      "user_123",
    ]);
  });

  it("uses managed scope only for meeting managers", () => {
    expect(getMeetingAccessScope(true)).toBe("workspace");
    expect(getMeetingAccessScope(false)).toBe("shared");
  });
});
