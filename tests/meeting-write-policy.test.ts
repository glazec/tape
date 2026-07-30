import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  getManageableMeetingCondition,
  getOwnedMeetingCondition,
} from "@/lib/meeting-write-policy";

const dialect = new PgDialect();

function toQuery(condition: SQL) {
  return dialect.sqlToQuery(condition);
}

describe("meeting write policy", () => {
  it("limits meeting management to the owner or team admins", () => {
    const query = toQuery(
      getManageableMeetingCondition(
        {
          domain: "example.com",
          teamId: "team_123",
          userId: "user_123",
        },
        "11111111-1111-4111-8111-111111111111",
      ),
    );

    expect(query.sql).toContain('"meetings"."owner_user_id" = $3');
    expect(query.sql).toContain('"team_memberships"');
    expect(query.sql).toContain('"team_memberships"."role" in (');
    expect(query.params).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "team_123",
      "user_123",
      "user_123",
      "admin",
      "owner",
    ]);
  });

  it("limits meeting deletion to the meeting owner", () => {
    const query = toQuery(
      getOwnedMeetingCondition(
        {
          domain: "example.com",
          teamId: "team_123",
          userId: "user_123",
        },
        "11111111-1111-4111-8111-111111111111",
      ),
    );

    expect(query.sql).toContain('"meetings"."owner_user_id"');
    expect(query.sql).not.toContain('"team_memberships"');
    expect(query.params).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "team_123",
      "user_123",
    ]);
  });
});
