ALTER TABLE "calendar_connections" ADD COLUMN "oauth_access_token" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "oauth_refresh_token" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "oauth_access_token_expires_at" timestamp with time zone;