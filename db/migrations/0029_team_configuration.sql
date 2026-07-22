ALTER TABLE "team_meeting_bot_profiles" ALTER COLUMN "bot_name" SET DEFAULT 'Tape Notetaker';--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "share_audience_name" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "share_audience_emails" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "teams"
SET
	"name" = CASE
		WHEN "name" IN ('iosg.vc workspace', 'iosg.vc guest workspace') THEN 'IOSG'
		ELSE "name"
	END,
	"share_audience_name" = 'IC team',
	"share_audience_emails" = '["jocy@iosg.vc","yiping@iosg.vc","frank@iosg.vc","mario@iosg.vc","jeffrey@iosg.vc","turbo@iosg.vc"]'::jsonb,
	"updated_at" = now()
WHERE EXISTS (
	SELECT 1
	FROM "allowed_domains"
	WHERE "allowed_domains"."team_id" = "teams"."id"
		AND "allowed_domains"."domain" = 'iosg.vc'
);--> statement-breakpoint
INSERT INTO "team_meeting_bot_profiles" ("team_id", "bot_name")
SELECT "teams"."id", 'IOSG Old Friend'
FROM "teams"
WHERE EXISTS (
	SELECT 1
	FROM "allowed_domains"
	WHERE "allowed_domains"."team_id" = "teams"."id"
		AND "allowed_domains"."domain" = 'iosg.vc'
)
ON CONFLICT ("team_id") DO NOTHING;
