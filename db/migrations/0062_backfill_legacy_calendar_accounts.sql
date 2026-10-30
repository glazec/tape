WITH "legacy_calendar_accounts" AS (
  SELECT
    "connection"."id",
    lower(trim("owner"."email")) AS "account_email",
    count(*) OVER (
      PARTITION BY "connection"."user_id", "connection"."provider"
    ) AS "legacy_connection_count"
  FROM "calendar_connections" AS "connection"
  INNER JOIN "users" AS "owner"
    ON "owner"."id" = "connection"."user_id"
  WHERE "connection"."provider" = 'google'
    AND "connection"."external_calendar_id" = 'primary'
    AND "connection"."account_email" IS NULL
    AND position('@' IN trim("owner"."email")) > 1
)
UPDATE "calendar_connections" AS "connection"
SET
  "account_email" = "legacy"."account_email",
  "updated_at" = now()
FROM "legacy_calendar_accounts" AS "legacy"
WHERE "connection"."id" = "legacy"."id"
  AND "legacy"."legacy_connection_count" = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "calendar_connections" AS "existing"
    WHERE "existing"."user_id" = "connection"."user_id"
      AND "existing"."provider" = "connection"."provider"
      AND lower("existing"."account_email") = "legacy"."account_email"
  );
