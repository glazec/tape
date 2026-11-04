ALTER TABLE "meetings" ADD COLUMN "followup_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "followup_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD COLUMN "translation_copies" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_language" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_default_language_check" CHECK ("users"."default_language" in ('zh-CN', 'en'));--> statement-breakpoint
UPDATE transcript_segments AS segment
SET translation_copies = jsonb_build_object(meeting.translation_language, segment.translated_text)
FROM meetings AS meeting
WHERE meeting.id = segment.meeting_id AND segment.translated_text IS NOT NULL;
