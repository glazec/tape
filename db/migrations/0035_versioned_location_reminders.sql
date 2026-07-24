ALTER TABLE "meeting_reminders" ADD COLUMN "delivery_idempotency_key" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD COLUMN "schedule_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_reminders" ADD COLUMN "dispatched_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "meeting_reminders" SET "status" = 'pending', "updated_at" = now() WHERE "status" = 'sending' AND "sent_at" IS NULL;--> statement-breakpoint
CREATE INDEX "meeting_reminders_undispatched_index" ON "meeting_reminders" USING btree ("scheduled_for") WHERE "meeting_reminders"."status" = 'pending' and "meeting_reminders"."sent_at" is null and "meeting_reminders"."dispatched_version" < "meeting_reminders"."schedule_version";
