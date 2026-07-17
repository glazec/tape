CREATE TABLE "meeting_access_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"role" "access_role" DEFAULT 'shared' NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"created_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_share_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"seed_meeting_id" uuid,
	"recipient_email" text NOT NULL,
	"scope" text NOT NULL,
	"role" "access_role" DEFAULT 'shared' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_share_policy_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"match_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_access_sources" ADD CONSTRAINT "meeting_access_sources_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_access_sources" ADD CONSTRAINT "meeting_access_sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_share_policies" ADD CONSTRAINT "meeting_share_policies_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_share_policies" ADD CONSTRAINT "meeting_share_policies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_share_policies" ADD CONSTRAINT "meeting_share_policies_seed_meeting_id_meetings_id_fk" FOREIGN KEY ("seed_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_share_policies" ADD CONSTRAINT "meeting_share_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "meeting_share_policy_keys" ADD CONSTRAINT "meeting_share_policy_keys_policy_id_meeting_share_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."meeting_share_policies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_access_sources_source_unique" ON "meeting_access_sources" USING btree ("meeting_id","recipient_email","source","source_id");
--> statement-breakpoint
CREATE INDEX "meeting_access_sources_active_index" ON "meeting_access_sources" USING btree ("meeting_id","recipient_email","revoked_at");
--> statement-breakpoint
CREATE INDEX "meeting_share_policies_seed_active_index" ON "meeting_share_policies" USING btree ("seed_meeting_id","revoked_at");
--> statement-breakpoint
CREATE INDEX "meeting_share_policies_lookup_index" ON "meeting_share_policies" USING btree ("team_id","owner_user_id","scope","revoked_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_share_policy_keys_policy_key_unique" ON "meeting_share_policy_keys" USING btree ("policy_id","match_key");
--> statement-breakpoint
CREATE INDEX "meeting_share_policy_keys_match_index" ON "meeting_share_policy_keys" USING btree ("match_key");
--> statement-breakpoint
INSERT INTO "meeting_share_policies" (
  "id", "team_id", "owner_user_id", "recipient_email", "scope", "role", "created_by_user_id", "revoked_at", "created_at", "updated_at"
)
SELECT
  rule."id", rule."team_id", rule."owner_user_id", lower(rule."recipient_email"), 'related', rule."role", rule."created_by_user_id", rule."revoked_at", rule."created_at", rule."updated_at"
FROM "meeting_share_rules" AS rule
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "meeting_share_policy_keys" ("policy_id", "match_key", "created_at", "updated_at")
SELECT rule."id", rule."match_key", rule."created_at", rule."updated_at"
FROM "meeting_share_rules" AS rule
ON CONFLICT ("policy_id", "match_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "meeting_share_policies" (
  "id", "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope", "role", "created_by_user_id", "revoked_at", "created_at", "updated_at"
)
SELECT
  access."id", meeting."team_id", meeting."owner_user_id", meeting."id", lower(app_user."email"), 'single', access."role", COALESCE(access."created_by_user_id", meeting."owner_user_id"), access."revoked_at", access."created_at", access."updated_at"
FROM "meeting_access" AS access
JOIN "meetings" AS meeting ON meeting."id" = access."meeting_id"
JOIN "users" AS app_user ON app_user."id" = access."user_id"
WHERE access."source" = 'manual'
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "meeting_share_policies" (
  "id", "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope", "role", "created_by_user_id", "revoked_at", "created_at", "updated_at"
)
SELECT
  invite."id", meeting."team_id", meeting."owner_user_id", meeting."id", lower(invite."email"), 'single', invite."role", invite."created_by_user_id", invite."revoked_at", invite."created_at", invite."updated_at"
FROM "meeting_share_invites" AS invite
JOIN "meetings" AS meeting ON meeting."id" = invite."meeting_id"
WHERE invite."source" = 'manual'
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "meeting_access_sources" (
  "meeting_id", "recipient_email", "role", "source", "source_id", "created_by_user_id", "revoked_at", "created_at", "updated_at"
)
SELECT
  access."meeting_id",
  lower(app_user."email"),
  access."role",
  CASE WHEN access."source" = 'participant' THEN 'participant' ELSE 'share_policy' END,
  CASE
    WHEN access."source" = 'participant' THEN access."source_id"
    WHEN access."source" = 'related_rule' THEN access."source_id"
    ELSE access."id"::text
  END,
  access."created_by_user_id",
  access."revoked_at",
  access."created_at",
  access."updated_at"
FROM "meeting_access" AS access
JOIN "users" AS app_user ON app_user."id" = access."user_id"
ON CONFLICT ("meeting_id", "recipient_email", "source", "source_id") DO UPDATE
SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
--> statement-breakpoint
INSERT INTO "meeting_access_sources" (
  "meeting_id", "recipient_email", "role", "source", "source_id", "created_by_user_id", "revoked_at", "created_at", "updated_at"
)
SELECT
  invite."meeting_id",
  lower(invite."email"),
  invite."role",
  CASE WHEN invite."source" = 'participant' THEN 'participant' ELSE 'share_policy' END,
  CASE
    WHEN invite."source" = 'participant' THEN invite."source_id"
    WHEN invite."source" = 'related_rule' THEN invite."source_id"
    ELSE invite."id"::text
  END,
  invite."created_by_user_id",
  invite."revoked_at",
  invite."created_at",
  invite."updated_at"
FROM "meeting_share_invites" AS invite
ON CONFLICT ("meeting_id", "recipient_email", "source", "source_id") DO UPDATE
SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "meeting_id", "user_id"
      ORDER BY ("revoked_at" IS NULL) DESC, "updated_at" DESC, "id"
    ) AS position
  FROM "meeting_access"
)
DELETE FROM "meeting_access"
WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);
--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "meeting_id", lower("email")
      ORDER BY ("revoked_at" IS NULL) DESC, ("accepted_at" IS NULL) DESC, "updated_at" DESC, "id"
    ) AS position
  FROM "meeting_share_invites"
)
DELETE FROM "meeting_share_invites"
WHERE "id" IN (SELECT "id" FROM ranked WHERE position > 1);
--> statement-breakpoint
UPDATE "meeting_access"
SET "source" = 'effective', "source_id" = 'materialized', "updated_at" = now();
--> statement-breakpoint
UPDATE "meeting_share_invites"
SET "email" = lower("email"), "source" = 'effective', "source_id" = 'materialized', "updated_at" = now();
--> statement-breakpoint
DROP INDEX "meeting_access_meeting_user_source_unique";
--> statement-breakpoint
DROP INDEX "meeting_share_invites_meeting_email_source_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_access_meeting_user_unique" ON "meeting_access" USING btree ("meeting_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_share_invites_meeting_email_unique" ON "meeting_share_invites" USING btree ("meeting_id","email");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mirror_legacy_meeting_share_rule() RETURNS trigger AS $$
BEGIN
  INSERT INTO "meeting_share_policies" (
    "id", "team_id", "owner_user_id", "recipient_email", "scope", "role", "created_by_user_id", "revoked_at", "created_at", "updated_at"
  ) VALUES (
    NEW."id", NEW."team_id", NEW."owner_user_id", lower(NEW."recipient_email"), 'related', NEW."role", NEW."created_by_user_id", NEW."revoked_at", NEW."created_at", NEW."updated_at"
  )
  ON CONFLICT ("id") DO UPDATE
  SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();

  INSERT INTO "meeting_share_policy_keys" ("policy_id", "match_key")
  VALUES (NEW."id", NEW."match_key")
  ON CONFLICT ("policy_id", "match_key") DO UPDATE SET "updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "meeting_share_rules_legacy_policy_trigger"
AFTER INSERT OR UPDATE ON "meeting_share_rules"
FOR EACH ROW EXECUTE FUNCTION mirror_legacy_meeting_share_rule();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mirror_legacy_meeting_access() RETURNS trigger AS $$
DECLARE
  recipient text;
  policy_id uuid;
  meeting_row record;
BEGIN
  IF NEW."source" = 'effective' THEN
    RETURN NEW;
  END IF;

  SELECT lower("email") INTO recipient FROM "users" WHERE "id" = NEW."user_id";

  IF NEW."source" = 'participant' THEN
    INSERT INTO "meeting_access_sources" (
      "meeting_id", "recipient_email", "role", "source", "source_id", "created_by_user_id", "revoked_at"
    ) VALUES (
      NEW."meeting_id", recipient, NEW."role", 'participant', NEW."source_id", NEW."created_by_user_id", NEW."revoked_at"
    )
    ON CONFLICT ("meeting_id", "recipient_email", "source", "source_id") DO UPDATE
    SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
    RETURN NEW;
  END IF;

  policy_id := CASE WHEN NEW."source" = 'related_rule' THEN NEW."source_id"::uuid ELSE NEW."id" END;

  IF NEW."source" <> 'related_rule' THEN
    SELECT "team_id", "owner_user_id" INTO meeting_row FROM "meetings" WHERE "id" = NEW."meeting_id";
    INSERT INTO "meeting_share_policies" (
      "id", "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope", "role", "created_by_user_id", "revoked_at"
    ) VALUES (
      policy_id, meeting_row."team_id", meeting_row."owner_user_id", NEW."meeting_id", recipient, 'single', NEW."role", COALESCE(NEW."created_by_user_id", meeting_row."owner_user_id"), NEW."revoked_at"
    ) ON CONFLICT ("id") DO UPDATE
    SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
  END IF;

  INSERT INTO "meeting_access_sources" (
    "meeting_id", "recipient_email", "role", "source", "source_id", "created_by_user_id", "revoked_at"
  ) VALUES (
    NEW."meeting_id", recipient, NEW."role", 'share_policy', policy_id::text, NEW."created_by_user_id", NEW."revoked_at"
  )
  ON CONFLICT ("meeting_id", "recipient_email", "source", "source_id") DO UPDATE
  SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "meeting_access_legacy_source_trigger"
AFTER INSERT OR UPDATE OF "role", "source", "source_id", "revoked_at" ON "meeting_access"
FOR EACH ROW EXECUTE FUNCTION mirror_legacy_meeting_access();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION mirror_legacy_meeting_invite() RETURNS trigger AS $$
DECLARE
  policy_id uuid;
  meeting_row record;
BEGIN
  IF NEW."source" = 'effective' THEN
    RETURN NEW;
  END IF;

  IF NEW."source" = 'participant' THEN
    INSERT INTO "meeting_access_sources" (
      "meeting_id", "recipient_email", "role", "source", "source_id", "created_by_user_id", "revoked_at"
    ) VALUES (
      NEW."meeting_id", lower(NEW."email"), NEW."role", 'participant', NEW."source_id", NEW."created_by_user_id", NEW."revoked_at"
    )
    ON CONFLICT ("meeting_id", "recipient_email", "source", "source_id") DO UPDATE
    SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
    RETURN NEW;
  END IF;

  policy_id := CASE WHEN NEW."source" = 'related_rule' THEN NEW."source_id"::uuid ELSE NEW."id" END;

  IF NEW."source" <> 'related_rule' THEN
    SELECT "team_id", "owner_user_id" INTO meeting_row FROM "meetings" WHERE "id" = NEW."meeting_id";
    INSERT INTO "meeting_share_policies" (
      "id", "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope", "role", "created_by_user_id", "revoked_at"
    ) VALUES (
      policy_id, meeting_row."team_id", meeting_row."owner_user_id", NEW."meeting_id", lower(NEW."email"), 'single', NEW."role", NEW."created_by_user_id", NEW."revoked_at"
    ) ON CONFLICT ("id") DO UPDATE
    SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
  END IF;

  INSERT INTO "meeting_access_sources" (
    "meeting_id", "recipient_email", "role", "source", "source_id", "created_by_user_id", "revoked_at"
  ) VALUES (
    NEW."meeting_id", lower(NEW."email"), NEW."role", 'share_policy', policy_id::text, NEW."created_by_user_id", NEW."revoked_at"
  )
  ON CONFLICT ("meeting_id", "recipient_email", "source", "source_id") DO UPDATE
  SET "role" = excluded."role", "revoked_at" = excluded."revoked_at", "updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "meeting_share_invites_legacy_source_trigger"
AFTER INSERT OR UPDATE OF "role", "source", "source_id", "revoked_at" ON "meeting_share_invites"
FOR EACH ROW EXECUTE FUNCTION mirror_legacy_meeting_invite();
