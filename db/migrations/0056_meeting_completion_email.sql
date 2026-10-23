ALTER TABLE "transcript_jobs" ADD COLUMN "completion_email_payload" jsonb;--> statement-breakpoint
ALTER TABLE "transcript_jobs" ADD COLUMN "completion_email_prepared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transcript_jobs" ADD COLUMN "completion_email_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transcript_jobs" ADD COLUMN "completion_email_id" text;--> statement-breakpoint
ALTER TABLE "transcript_jobs" ADD COLUMN "completion_email_ready_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "transcript_jobs_pending_completion_email_index" ON "transcript_jobs" USING btree ("completion_email_ready_at") WHERE "transcript_jobs"."mode" = 'replace' and "transcript_jobs"."completion_email_ready_at" is not null and "transcript_jobs"."completion_email_sent_at" is null;