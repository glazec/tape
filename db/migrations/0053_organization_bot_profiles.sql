DROP INDEX "team_meeting_bot_profiles_team_unique";--> statement-breakpoint
ALTER TABLE "team_meeting_bot_profiles" ADD COLUMN "domain" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "preferred_bot_domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "team_meeting_bot_profiles_team_domain_unique" ON "team_meeting_bot_profiles" USING btree ("team_id","domain");