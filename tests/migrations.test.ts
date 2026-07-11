import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("database migrations", () => {
  it("backfills existing calendar-backed renamed meetings as manual titles", () => {
    const sql = readFileSync(
      "db/migrations/0020_meeting_title_source.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain(
      'ALTER TABLE "meetings" ADD COLUMN "title_source" text DEFAULT \'calendar\' NOT NULL',
    );
    expect(sql).toContain('UPDATE "meetings"');
    expect(sql).toContain('SET "title_source" = \'manual\'');
    expect(sql).toContain('FROM "calendar_events"');
    expect(sql).toContain(
      '"meetings"."calendar_event_id" = "calendar_events"."id"',
    );
    expect(sql).toContain(
      '"meetings"."title" IS DISTINCT FROM "calendar_events"."title"',
    );
  });

  it("restores one administrator to every internal team left adminless", () => {
    const sql = readFileSync(
      "db/migrations/0021_restore_team_admin_roles.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain("FROM \"allowed_domains\"");
    expect(sql).toContain(
      "elevated_membership.\"role\" IN ('admin', 'owner')",
    );
    expect(sql).toContain("ORDER BY membership.\"team_id\"");
    expect(sql).toContain("SET \"role\" = 'admin'");
  });
});
