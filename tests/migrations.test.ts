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

  it("deduplicates active share policies before enforcing one identity", () => {
    const sql = readFileSync(
      "db/migrations/0026_share_policy_integrity.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain('INSERT INTO "meeting_share_policy_keys"');
    expect(sql).toContain('INSERT INTO "meeting_access_sources"');
    expect(sql).toContain('UPDATE "meeting_access_sources"');
    expect(sql).toContain('UPDATE "meeting_share_policies"');
    expect(sql).toContain('SET "revoked_at" = now()');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "meeting_share_policies_active_identity_unique"',
    );
    expect(sql.indexOf('SET "revoked_at" = now()')).toBeLessThan(
      sql.indexOf(
        'CREATE UNIQUE INDEX "meeting_share_policies_active_identity_unique"',
      ),
    );
  });

  it("adds durable per meeting access exclusions", () => {
    const sql = readFileSync(
      "db/migrations/0028_meeting_access_exclusions.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain('CREATE TABLE "meeting_access_exclusions"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "meeting_access_exclusions_meeting_email_unique"',
    );
    expect(sql).toContain("organization_migration");
    expect(sql).toContain('meeting."organization_access_enabled" = true');
    expect(sql).toContain("membership.\"role\" <> 'external'");
  });

  it("moves the legacy IOSG audience into editable team configuration", () => {
    const sql = readFileSync(
      "db/migrations/0029_team_configuration.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain('ADD COLUMN "share_audience_name" text');
    expect(sql).toContain('ADD COLUMN "share_audience_emails" jsonb');
    expect(sql).toContain('"allowed_domains"."domain" = \'iosg.vc\'');
    expect(sql).toContain("THEN 'IOSG'");
    expect(sql).toContain("SET DEFAULT 'Tape Notetaker'");
    expect(sql).toContain('ON CONFLICT ("team_id") DO NOTHING');
  });

  it("adds constrained team and meeting translation languages", () => {
    const sql = readFileSync(
      "db/migrations/0030_translation_language.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain(
      'ALTER TABLE "teams" ADD COLUMN "translation_language" text DEFAULT \'zh-CN\' NOT NULL',
    );
    expect(sql).toContain(
      'ALTER TABLE "meetings" ADD COLUMN "translation_language" text DEFAULT \'zh-CN\' NOT NULL',
    );
    expect(sql).toContain("teams_translation_language_check");
    expect(sql).toContain("meetings_translation_language_check");
    expect(sql).toContain("in ('zh-CN', 'en')");
  });

  it("adds an idempotent provider cost ledger with historical estimates", () => {
    const sql = readFileSync(
      "db/migrations/0033_robust_ego.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain('CREATE TABLE "provider_usage_events"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "provider_usage_events_idempotency_unique"',
    );
    expect(sql).toContain(
      'ADD COLUMN "billing_keyterms_used" boolean DEFAULT false NOT NULL',
    );
    expect(sql).toContain('\'recall:recording:\' || "recordings"."id"');
    expect(sql).toContain(
      '\'elevenlabs:transcription:\' || "elevenlabs_usage"."id"',
    );
    expect(
      sql.match(/ON CONFLICT \("idempotency_key"\) DO NOTHING/g),
    ).toHaveLength(2);
  });

  it("adds workspace credits and fills missing historical Recall usage", () => {
    const sql = readFileSync(
      "db/migrations/0034_kind_randall.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain('ADD COLUMN "credit_limit_usd_micros" bigint');
    expect(sql).toContain("teams_credit_limit_nonnegative");
    expect(sql).toContain('"credit_limit_usd_micros" = 5000000');
    expect(sql).toContain('"allowed_domains"."domain" = \'iosg.vc\'');
    expect(sql).toContain('"credit_limit_usd_micros" = NULL');
    expect(sql).toContain('"team_memberships"."role" = \'external\'');
    expect(sql).toContain('SET "role" = \'owner\'');
    expect(sql).toContain('FROM "allowed_domains"');
    expect(sql).toContain(
      '\'recall:legacy-meeting:\' || "legacy_recall_usage"."meeting_id"',
    );
    expect(sql).toContain("'historicalEstimate', true");
    expect(sql).toContain('ON CONFLICT ("idempotency_key") DO NOTHING');
  });

  it("adds versioned durable location reminder scheduling", () => {
    const sql = readFileSync(
      "db/migrations/0035_versioned_location_reminders.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain(
      'ADD COLUMN "delivery_idempotency_key" uuid DEFAULT gen_random_uuid() NOT NULL',
    );
    expect(sql).toContain(
      'ADD COLUMN "schedule_version" integer DEFAULT 1 NOT NULL',
    );
    expect(sql).toContain(
      'ADD COLUMN "dispatched_version" integer DEFAULT 0 NOT NULL',
    );
    expect(sql).toContain(
      `SET "status" = 'pending', "updated_at" = now() WHERE "status" = 'sending' AND "sent_at" IS NULL`,
    );
    expect(sql).toContain(
      'CREATE INDEX "meeting_reminders_undispatched_index"',
    );
  });

  it("enforces caller scoped row level security for tenant data", () => {
    const sql = readFileSync(
      "db/migrations/0037_tenant_rls.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain("create role tape_authenticated");
    expect(sql).toContain("create role tape_mcp");
    expect(sql).toContain("nobypassrls");
    expect(sql).toContain(
      "current_setting('request.jwt.claims', true)",
    );
    expect(sql).toContain(
      "create or replace function app_private.can_read_meeting",
    );
    expect(sql).toContain(
      "create or replace function app_private.can_write_meeting",
    );
    expect(sql).toContain(
      "alter table public.meetings force row level security",
    );
    expect(sql).toContain(
      "alter table public.users force row level security",
    );
    expect(sql).toContain(
      "revoke all on table public.vendor_webhook_events from tape_authenticated",
    );
    expect(sql).toContain("and role = 'owner'");
    expect(sql).toContain("role = 'member'");
    expect(sql).toContain("and invite.role = meeting_access.role");
    expect(sql).toContain(
      "create trigger meeting_share_invites_protect_recipient_update",
    );

    for (const table of [
      "meeting_attendees",
      "share_links",
      "meeting_access_sources",
      "meeting_access_exclusions",
      "recordings",
      "media_assets",
      "local_recording_attempts",
      "local_recordings",
      "transcript_jobs",
      "transcript_segments",
      "meeting_entities",
      "meeting_participant_timeline",
      "meeting_reminders",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }

    const intentionallyGlobalTables = new Set([
      "request_rate_limits",
      "vendor_webhook_events",
    ]);
    const tenantTables = Object.values(schema).flatMap((value) => {
      try {
        const table = getTableName(
          value as Parameters<typeof getTableName>[0],
        );

        return typeof table !== "string" ||
          intentionallyGlobalTables.has(table)
          ? []
          : [table];
      } catch {
        return [];
      }
    });

    for (const table of tenantTables) {
      expect(
        sql.includes(`public.${table}`) || sql.includes(`'${table}'`),
        `${table} must have an RLS policy`,
      ).toBe(true);
    }
  });

  it("materializes readable meetings once for child table policies", () => {
    const sql = readFileSync(
      "db/migrations/0043_dashboard_rls_read_performance.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain(
      "create or replace function app_private.readable_meeting_ids()",
    );
    expect(sql).toContain("with current_identity as materialized");
    expect(sql).toContain(
      "meeting.owner_user_id = current_identity.user_id",
    );
    expect(sql).toContain("membership.role in ('admin', 'owner')");
    expect(sql).toContain("access_grant.revoked_at is null");
    expect(sql).toContain(
      "revoke all on function app_private.readable_meeting_ids() from public",
    );
    expect(sql).toContain(
      "to tape_authenticated, tape_mcp using (meeting_id in (select readable.meeting_id from app_private.readable_meeting_ids() as readable))",
    );

    for (const table of [
      "meeting_attendees",
      "meeting_access_sources",
      "meeting_access_exclusions",
      "recordings",
      "media_assets",
      "local_recording_attempts",
      "local_recordings",
      "transcript_jobs",
      "transcript_segments",
      "meeting_entities",
      "meeting_participant_timeline",
      "meeting_reminders",
    ]) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it("scopes dashboard transcript stats to readable meetings", () => {
    const sql = readFileSync(
      "db/migrations/0044_dashboard_transcript_stats.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain(
      "create or replace function app_private.meeting_library_transcript_stats( target_meeting_ids uuid[] )",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain(
      "inner join app_private.readable_meeting_ids() as readable using (meeting_id)",
    );
    expect(sql).toContain("job.status = 'completed'");
    expect(sql).toContain("job.mode = 'replace'");
    expect(sql).toContain("job.mode = 'append'");
    expect(sql).toContain(
      "revoke all on function app_private.meeting_library_transcript_stats(uuid[]) from public",
    );
    expect(sql).toContain(
      "grant execute on function app_private.meeting_library_transcript_stats(uuid[]) to tape_authenticated, tape_mcp",
    );
  });

  it("keeps operational rate limits private from tenant roles", () => {
    const sql = readFileSync(
      "db/migrations/0039_restrict_rate_limit_table.sql",
      "utf8",
    ).toLowerCase();

    expect(sql).toContain(
      'revoke all on table "request_rate_limits" from "tape_authenticated"',
    );
  });

  it("maps verified MCP email identity after subject lookup", () => {
    const sql = readFileSync(
      "db/migrations/0040_mcp_verified_email_identity.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql.indexOf("app_user.auth_user_id")).toBeLessThan(
      sql.indexOf("lower(app_user.email)"),
    );
    expect(sql).toContain("app_private.claim_email()");
  });

  it("records MCP onboarding usage through one bounded function", () => {
    const sql = readFileSync(
      "db/migrations/0041_mcp_onboarding_usage.sql",
      "utf8",
    ).replace(/\s+/g, " ");

    expect(sql).toContain(
      "create or replace function app_private.record_mcp_onboarding_use",
    );
    expect(sql).toContain("security definer");
    expect(sql).toContain("app_private.current_user_id()");
    expect(sql).toContain("app_private.can_discover_team(target_team_id)");
    expect(sql).toContain("'onboarding_mcp_used'");
    expect(sql).toContain(
      "revoke all on function app_private.record_mcp_onboarding_use(uuid) from public",
    );
    expect(sql).toContain(
      "grant execute on function app_private.record_mcp_onboarding_use(uuid) to tape_mcp",
    );
  });
});
