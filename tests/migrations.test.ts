import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

describe("database migrations", () => {
  it("registers every migration in chronological order", () => {
    const journal = JSON.parse(
      readFileSync("db/migrations/meta/_journal.json", "utf8"),
    ) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const migrationTags = readdirSync("db/migrations")
      .filter((file) => file.endsWith(".sql"))
      .map((file) => file.slice(0, -4))
      .sort();

    expect(journal.entries.map((entry) => entry.tag)).toEqual(migrationTags);

    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index].when).toBeGreaterThan(
        journal.entries[index - 1].when,
      );
    }
  });

  it("keeps every schema table and column in the latest migration snapshot", () => {
    const journal = JSON.parse(
      readFileSync("db/migrations/meta/_journal.json", "utf8"),
    ) as {
      entries: Array<{ tag: string }>;
    };
    const latestMigration = journal.entries.at(-1)?.tag;

    expect(latestMigration).toBeDefined();

    const snapshot = JSON.parse(
      readFileSync(
        `db/migrations/meta/${latestMigration?.split("_")[0]}_snapshot.json`,
        "utf8",
      ),
    ) as {
      tables: Record<
        string,
        { name: string; columns: Record<string, unknown> }
      >;
    };
    const schemaTables = Object.values(schema).flatMap((value) => {
      try {
        const table = value as Parameters<typeof getTableName>[0];

        return [
          [
            getTableName(table),
            Object.values(getTableColumns(table))
              .map((column) => column.name)
              .sort(),
          ],
        ] as Array<[string, string[]]>;
      } catch {
        return [];
      }
    });
    const snapshotTables = Object.values(snapshot.tables).map(
      (table) => [table.name, Object.keys(table.columns).sort()] as const,
    );

    expect(Object.fromEntries(schemaTables)).toEqual(
      Object.fromEntries(snapshotTables),
    );
  });

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

  it("preserves the deployed participant migration and repairs it additively", () => {
    const participantMigration = readFileSync(
      "db/migrations/0024_participant_related_permissions.sql",
    );
    const participantSql = readFileSync(
      "db/migrations/0024_participant_related_permissions.sql",
      "utf8",
    ).replace(/\s+/g, " ");
    const lifecycleSql = readFileSync(
      "db/migrations/0025_sharing_policy_lifecycle.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(createHash("sha256").update(participantMigration).digest("hex")).toBe(
      "9410383c5e992cbf6cb0021543b216e63146cf7a9138418b78d313b3a2a47336",
    );
    expect(participantSql).toContain(
      'ADD COLUMN "source" text DEFAULT \'manual\' NOT NULL',
    );
    expect(participantSql).toContain('SET "is_internal" = true');
    expect(participantSql).toContain("'attendee'::\"access_role\"");
    expect(participantSql).toContain("'participant'");
    expect(participantSql).toContain(
      'app_user."id" <> meeting."owner_user_id"',
    );
    expect(participantSql).toContain(
      'DROP INDEX IF EXISTS "meeting_access_meeting_user_unique"',
    );
    expect(lifecycleSql).toContain('CREATE TABLE "meeting_access_sources"');
    expect(lifecycleSql).toContain('CREATE TABLE "meeting_share_policies"');
    expect(lifecycleSql).toContain(
      'CREATE TABLE "meeting_share_policy_keys"',
    );
    expect(lifecycleSql).toContain(
      'CREATE UNIQUE INDEX "meeting_access_meeting_user_unique"',
    );
    expect(lifecycleSql).toContain(
      'CREATE UNIQUE INDEX "meeting_share_invites_meeting_email_unique"',
    );
    expect(lifecycleSql.indexOf('DELETE FROM "meeting_access"')).toBeLessThan(
      lifecycleSql.indexOf(
        'CREATE UNIQUE INDEX "meeting_access_meeting_user_unique"',
      ),
    );
  });

  it("keeps the sharing lifecycle snapshots in lineage", () => {
    const participantSnapshot = JSON.parse(
      readFileSync("db/migrations/meta/0024_snapshot.json", "utf8"),
    ) as { id: string };
    const snapshot = JSON.parse(
      readFileSync("db/migrations/meta/0025_snapshot.json", "utf8"),
    ) as {
      prevId: string;
      tables: Record<string, { columns: Record<string, unknown> }>;
    };

    expect(snapshot.prevId).toBe(participantSnapshot.id);
    expect(snapshot.tables).toHaveProperty("public.meeting_access_sources");
    expect(snapshot.tables).toHaveProperty("public.meeting_share_policies");
    expect(snapshot.tables).toHaveProperty(
      "public.meeting_share_policy_keys",
    );
  });
});
