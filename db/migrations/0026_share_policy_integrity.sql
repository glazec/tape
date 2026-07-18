UPDATE "meeting_share_policies"
SET "recipient_email" = lower("recipient_email"), "updated_at" = now()
WHERE "recipient_email" <> lower("recipient_email");
--> statement-breakpoint
WITH "ranked_policies" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope"
      ORDER BY "created_at", "id"
    ) AS "keeper_id"
  FROM "meeting_share_policies"
  WHERE "revoked_at" IS NULL
)
INSERT INTO "meeting_share_policy_keys" (
  "policy_id", "match_key", "created_at", "updated_at"
)
SELECT
  ranked."keeper_id",
  policy_key."match_key",
  policy_key."created_at",
  now()
FROM "ranked_policies" AS ranked
JOIN "meeting_share_policy_keys" AS policy_key
  ON policy_key."policy_id" = ranked."id"
WHERE ranked."id" <> ranked."keeper_id"
ON CONFLICT ("policy_id", "match_key") DO UPDATE
SET "updated_at" = now();
--> statement-breakpoint
WITH "ranked_policies" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope"
      ORDER BY "created_at", "id"
    ) AS "keeper_id"
  FROM "meeting_share_policies"
  WHERE "revoked_at" IS NULL
)
INSERT INTO "meeting_access_sources" (
  "meeting_id",
  "recipient_email",
  "role",
  "source",
  "source_id",
  "created_by_user_id",
  "revoked_at",
  "created_at",
  "updated_at"
)
SELECT
  source."meeting_id",
  source."recipient_email",
  source."role",
  'share_policy',
  ranked."keeper_id"::text,
  source."created_by_user_id",
  NULL,
  source."created_at",
  now()
FROM "meeting_access_sources" AS source
JOIN "ranked_policies" AS ranked
  ON source."source" = 'share_policy'
  AND source."source_id" = ranked."id"::text
WHERE ranked."id" <> ranked."keeper_id"
  AND source."revoked_at" IS NULL
ON CONFLICT ("meeting_id", "recipient_email", "source", "source_id") DO UPDATE
SET "role" = excluded."role",
    "created_by_user_id" = excluded."created_by_user_id",
    "revoked_at" = NULL,
    "updated_at" = now();
--> statement-breakpoint
WITH "ranked_policies" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope"
      ORDER BY "created_at", "id"
    ) AS "keeper_id"
  FROM "meeting_share_policies"
  WHERE "revoked_at" IS NULL
)
UPDATE "meeting_access_sources" AS source
SET "revoked_at" = COALESCE(source."revoked_at", now()), "updated_at" = now()
FROM "ranked_policies" AS ranked
WHERE ranked."id" <> ranked."keeper_id"
  AND source."source" = 'share_policy'
  AND source."source_id" = ranked."id"::text;
--> statement-breakpoint
WITH "ranked_policies" AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "team_id", "owner_user_id", "seed_meeting_id", "recipient_email", "scope"
      ORDER BY "created_at", "id"
    ) AS "keeper_id"
  FROM "meeting_share_policies"
  WHERE "revoked_at" IS NULL
)
UPDATE "meeting_share_policies" AS policy
SET "revoked_at" = now(), "updated_at" = now()
FROM "ranked_policies" AS ranked
WHERE policy."id" = ranked."id"
  AND ranked."id" <> ranked."keeper_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_share_policies_active_identity_unique" ON "meeting_share_policies" USING btree ("team_id","owner_user_id","seed_meeting_id","recipient_email","scope") WHERE "meeting_share_policies"."revoked_at" is null;
