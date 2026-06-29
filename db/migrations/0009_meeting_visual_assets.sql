ALTER TABLE "media_assets" ADD COLUMN "captured_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "timestamp_ms" integer;
