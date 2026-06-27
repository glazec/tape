ALTER TABLE "calendar_connections" ADD COLUMN "recall_calendar_id" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "recall_calendar_status" text;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD COLUMN "recall_calendar_last_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_recall_calendar_id_unique" ON "calendar_connections" USING btree ("recall_calendar_id") WHERE "recall_calendar_id" is not null;
