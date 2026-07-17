import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  getMeetingAccessScope,
  getReadableMeetingsCondition,
} from "@/lib/meeting-access-policy";

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

describe("meeting access policy", () => {
  it("limits reads to owners, team managers, and active grants", () => {
    const query = toQuery(
      getReadableMeetingsCondition({
        teamId: "team_123",
        userId: "user_123",
        domain: "example.com",
        canCreateMeetings: true,
      }),
    );

    expect(query.sql).toContain('"meetings"."owner_user_id" = $1');
    expect(query.sql).toContain('"team_memberships"');
    expect(query.sql).toContain('"meeting_access"');
    expect(query.sql).toContain('"meeting_access"."revoked_at" is null');
    expect(query.sql).not.toContain('"meetings"."team_id" =');
    expect(query.params).toContain("user_123");
  });

  it("uses managed scope only for meeting managers", () => {
    expect(getMeetingAccessScope(true)).toBe("workspace");
    expect(getMeetingAccessScope(false)).toBe("shared");
  });
});
